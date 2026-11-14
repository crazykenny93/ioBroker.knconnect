"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_axios = __toESM(require("axios"));
const BASE_URL = "https://connectoreu.shadeconnector.com:8443";
const generateMsgId = () => new Date().toISOString().replace(/[^0-9]/g, "");
class Knconnect extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: "knconnect"
    });
    this.accessToken = "";
    this.sceneCodes = /* @__PURE__ */ new Set();
    this.devices = /* @__PURE__ */ new Map();
    this.roomCodes = /* @__PURE__ */ new Set();
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  async requestAccessToken() {
    var _a;
    const login = await import_axios.default.post(
      `${BASE_URL}/userCenter/user/login`,
      new URLSearchParams({
        loginName: this.config.loginName,
        password: this.config.password,
        appCode: "c62c8a8c-4b35-4783-9168-65b06a12a77d",
        msgId: generateMsgId()
      })
    );
    const token = (_a = login.data) == null ? void 0 : _a.accessToken;
    if (typeof token !== "string" || token.trim() === "") {
      throw new Error("KN Connect login returned no access token");
    }
    this.accessToken = token;
  }
  async login() {
    if (!this.loginPromise) {
      this.loginPromise = this.requestAccessToken().finally(() => {
        this.loginPromise = void 0;
      });
    }
    await this.loginPromise;
  }
  async authenticatedPost(path, params = {}) {
    var _a, _b, _c;
    if (!this.accessToken)
      await this.login();
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = this.accessToken;
      try {
        const response = await import_axios.default.post(
          `${BASE_URL}${path}`,
          new URLSearchParams({ ...params, accessToken: token, msgId: generateMsgId() })
        );
        if (String((_a = response.data) == null ? void 0 : _a.retCode) !== "20108") {
          if (String((_b = response.data) == null ? void 0 : _b.retCode) !== "20000")
            throw new Error("KN Connect cloud request failed");
          return response.data;
        }
      } catch (error) {
        const status = (_c = error == null ? void 0 : error.response) == null ? void 0 : _c.status;
        if (status !== 401)
          throw error;
      }
      if (attempt === 1) {
        if (this.accessToken === token)
          this.accessToken = "";
        throw new Error("KN Connect rejected the renewed access token");
      }
      this.log.info("KN Connect token rejected; renewing login and retrying once.");
      if (this.accessToken === token)
        await this.login();
    }
    throw new Error("KN Connect authentication failed");
  }
  async channel(id, name) {
    await this.setObjectNotExistsAsync(id, { type: "channel", common: { name }, native: {} });
    await this.extendObjectAsync(id, { common: { name } });
  }
  async state(id, common) {
    await this.setObjectNotExistsAsync(id, { type: "state", common, native: {} });
  }
  async button(id, name) {
    await this.state(id, { name, type: "boolean", role: "button", read: false, write: true, def: false });
  }
  async controls(id) {
    for (const action of ["open", "close", "stop"])
      await this.button(`${id}.${action}`, action);
    await this.state(`${id}.targetPosition`, {
      name: "Target position (0 = open, 100 = closed)",
      type: "number",
      role: "level.blind",
      read: true,
      write: true,
      min: 0,
      max: 100,
      unit: "%"
    });
  }
  async onReady() {
    try {
      await this.login();
    } catch {
      this.log.error("KN Connect login failed. Check credentials and cloud availability.");
      return;
    }
    await this.state("triggerScene", {
      name: "Trigger scene by code",
      type: "string",
      role: "text",
      read: true,
      write: true
    });
    this.subscribeStates("triggerScene");
    const results = await Promise.allSettled([this.loadScenes(), this.loadDevices(), this.loadRooms()]);
    const names = ["scene", "device", "room"];
    results.forEach((result, index) => {
      if (result.status === "rejected")
        this.log.error(`KN Connect ${names[index]} loading failed.`);
    });
  }
  async loadScenes() {
    const scenes = await this.authenticatedPost("/userCenter/sceneService/getScenes");
    if (!Array.isArray(scenes.scenes))
      throw new Error("Invalid scene list");
    await this.channel("scenes", "Scenes");
    for (const scene of scenes.scenes) {
      if (!this.validId(scene.sceneCode) || typeof scene.sceneName !== "string")
        continue;
      this.sceneCodes.add(scene.sceneCode);
      const id = `scenes.${scene.sceneCode}`;
      await this.channel(id, scene.sceneName);
      await this.state(`${id}.name`, { name: "Name", type: "string", role: "text", read: true, write: false });
      await this.setStateAsync(`${id}.name`, { val: scene.sceneName, ack: true });
      await this.button(`${id}.trigger`, "Trigger scene");
    }
    this.subscribeStates("scenes.*.trigger");
  }
  validId(value) {
    return typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);
  }
  async loadDevices() {
    const response = await this.authenticatedPost("/userCenter/deviceService/listWithSlaves");
    if (!Array.isArray(response.devices))
      throw new Error("Invalid device list");
    await this.channel("devices", "Blinds");
    const visit = async (devices) => {
      for (const device of devices) {
        if (this.validId(device.mac) && ["10000000", "22000000", "22000002", "22000005"].includes(device.deviceType)) {
          this.devices.set(device.mac, { mac: device.mac, deviceType: device.deviceType });
          await this.channel(`devices.${device.mac}`, device.deviceAlias || device.mac);
          await this.controls(`devices.${device.mac}`);
        }
        if (Array.isArray(device.childs))
          await visit(device.childs);
      }
    };
    await visit(response.devices);
    this.subscribeStates("devices.*");
  }
  async loadRooms() {
    const response = await this.authenticatedPost("/userCenter/areaService/getAreas");
    if (!Array.isArray(response.areas))
      throw new Error("Invalid room list");
    await this.channel("rooms", "Rooms");
    const visit = async (areas) => {
      for (const area of areas) {
        if (area.areaLevel === 3 && this.validId(area.areaCode)) {
          this.roomCodes.add(area.areaCode);
          const id = `rooms.${area.areaCode}`;
          await this.channel(id, area.areaName || area.areaCode);
          await this.state(`${id}.deviceIds`, {
            name: "Assigned blind IDs (JSON array)",
            type: "string",
            role: "json",
            read: true,
            write: true,
            def: "[]"
          });
          if (!await this.getStateAsync(`${id}.deviceIds`)) {
            await this.setStateAsync(`${id}.deviceIds`, { val: "[]", ack: true });
          }
          await this.controls(id);
        }
        if (Array.isArray(area.childAreas))
          await visit(area.childAreas);
      }
    };
    await visit(response.areas);
    this.subscribeStates("rooms.*");
  }
  parseMembers(value) {
    if (typeof value !== "string")
      throw new Error("Invalid room assignment");
    const members = JSON.parse(value);
    if (!Array.isArray(members) || !members.every((id) => typeof id === "string" && this.devices.has(id))) {
      throw new Error("Unknown blind in room assignment");
    }
    return [...new Set(members)];
  }
  async deviceCommand(deviceId, params) {
    const device = this.devices.get(deviceId);
    if (!device)
      throw new Error("Unknown blind");
    await this.authenticatedPost("/userCenter/deviceService/deviceControl", { ...device, ...params });
  }
  onUnload(callback) {
    try {
      callback();
    } catch (e) {
      callback();
    }
  }
  async onStateChange(id, state) {
    var _a;
    if (!state || state.ack || !id.startsWith(`${this.namespace}.`))
      return;
    const relative = id.slice(this.namespace.length + 1);
    if (relative === "triggerScene" && typeof state.val === "string" && state.val.trim()) {
      try {
        await this.authenticatedPost("/userCenter/sceneService/triggerScene", { sceneCode: state.val });
      } catch {
        this.log.error("KN Connect scene could not be triggered. Check credentials and cloud availability.");
      } finally {
        this.setState("triggerScene", { val: null, ack: true });
      }
      return;
    }
    const [kind, code, action, extra] = relative.split(".");
    if (extra !== void 0)
      return;
    if (kind === "scenes" && action === "trigger" && state.val === true && this.sceneCodes.has(code)) {
      try {
        await this.authenticatedPost("/userCenter/sceneService/triggerScene", { sceneCode: code });
      } catch {
        this.log.error("KN Connect scene could not be triggered.");
      } finally {
        await this.setStateAsync(relative, { val: false, ack: true });
      }
      return;
    }
    if (!(kind === "devices" && this.devices.has(code)) && !(kind === "rooms" && this.roomCodes.has(code)))
      return;
    if (kind === "rooms" && action === "deviceIds") {
      try {
        const members = this.parseMembers(state.val);
        await this.setStateAsync(relative, { val: JSON.stringify(members), ack: true });
      } catch {
        this.log.error("KN Connect room assignment must be a JSON array of discovered blind IDs.");
      }
      return;
    }
    const operations = { open: "1", close: "0", stop: "2" };
    const isButton = Object.prototype.hasOwnProperty.call(operations, action);
    if (isButton ? state.val !== true : action !== "targetPosition" || typeof state.val !== "number" || !Number.isFinite(state.val) || state.val < 0 || state.val > 100)
      return;
    const params = isButton ? { operation: operations[action] } : { targetPosition: String(state.val) };
    try {
      const members = kind === "devices" ? [code] : this.parseMembers((_a = await this.getStateAsync(`rooms.${code}.deviceIds`)) == null ? void 0 : _a.val);
      if (!members.length)
        throw new Error("Room has no assigned blinds");
      const results = await Promise.allSettled(members.map((member) => this.deviceCommand(member, params)));
      if (results.some((result) => result.status === "rejected"))
        throw new Error("Blind command failed");
      if (!isButton)
        await this.setStateAsync(relative, { val: state.val, ack: true });
    } catch {
      this.log.error("KN Connect blind command failed. Check room assignment, credentials and cloud availability.");
    } finally {
      if (isButton)
        await this.setStateAsync(relative, { val: false, ack: true });
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new Knconnect(options);
} else {
  (() => new Knconnect())();
}
//# sourceMappingURL=main.js.map

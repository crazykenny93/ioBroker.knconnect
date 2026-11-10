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
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_axios = __toESM(require("axios"));
const BASE_URL = "https://connectoreu.shadeconnector.com:8443";
const generateMsgId = () => (/* @__PURE__ */ new Date()).toISOString().replace(/[^0-9]/g, "");
class Knconnect extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: "knconnect"
    });
    this.accessToken = "";
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
    var _a, _b;
    if (!this.accessToken) await this.login();
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = this.accessToken;
      try {
        const response = await import_axios.default.post(
          `${BASE_URL}${path}`,
          new URLSearchParams({ ...params, accessToken: token, msgId: generateMsgId() })
        );
        if (String((_a = response.data) == null ? void 0 : _a.retCode) !== "20108") return response.data;
      } catch (error) {
        const status = (_b = error == null ? void 0 : error.response) == null ? void 0 : _b.status;
        if (status !== 401) throw error;
      }
      if (attempt === 1) {
        if (this.accessToken === token) this.accessToken = "";
        throw new Error("KN Connect rejected the renewed access token");
      }
      this.log.info("KN Connect token rejected; renewing login and retrying once.");
      if (this.accessToken === token) await this.login();
    }
    throw new Error("KN Connect authentication failed");
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    let scenes;
    try {
      await this.login();
      scenes = await this.authenticatedPost("/userCenter/sceneService/getScenes");
    } catch {
      this.log.error("KN Connect login or scene loading failed. Check credentials and cloud availability.");
      return;
    }
    this.log.info("Scenes: " + JSON.stringify(scenes));
    this.setObjectNotExistsAsync("scenes", {
      type: "channel",
      common: {
        name: "scenes"
      },
      native: {}
    });
    this.setObjectNotExistsAsync("devices", {
      type: "channel",
      common: {
        name: "devices"
      },
      native: {}
    });
    this.setObjectNotExists("triggerScene", {
      type: "state",
      common: {
        name: "triggerScene",
        type: "string",
        role: "text",
        read: true,
        write: true
      },
      native: {}
    });
    for (const scene of scenes.scenes) {
      this.setObjectNotExists(`scenes.${scene.sceneCode}`, {
        type: "channel",
        common: {
          name: scene.sceneCode
        },
        native: {}
      });
      this.setObjectNotExists(`scenes.${scene.sceneCode}.name`, {
        type: "state",
        common: {
          name: "name",
          type: "string",
          role: "text",
          read: true,
          write: false
        },
        native: {}
      });
      this.setState(`scenes.${scene.sceneCode}.name`, scene.sceneName);
    }
    this.subscribeStates("triggerScene");
    const passwordResult = await this.checkPasswordAsync("admin", "iobroker");
    this.log.info("check user admin pw iobroker: " + passwordResult);
    const groupResult = await this.checkGroupAsync("admin", "admin");
    this.log.info("check group user admin group admin: " + groupResult);
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   */
  onUnload(callback) {
    try {
      callback();
    } catch (e) {
      callback();
    }
  }
  // If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
  // You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
  // /**
  //  * Is called if a subscribed object changes
  //  */
  // private onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {
  //     if (obj) {
  //         // The object was changed
  //         this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
  //     } else {
  //         // The object was deleted
  //         this.log.info(`object ${id} deleted`);
  //     }
  // }
  /**
   * Is called if a subscribed state changes
   */
  async onStateChange(id, state) {
    if (state) {
      if (id.endsWith(".triggerScene") && !state.ack && typeof state.val === "string" && state.val.trim() !== "") {
        this.log.info(`trigger scene: ${state.val}`);
        try {
          await this.authenticatedPost("/userCenter/sceneService/triggerScene", {
            sceneCode: state.val
          });
        } catch {
          this.log.error("KN Connect scene could not be triggered. Check credentials and cloud availability.");
        } finally {
          this.setState("triggerScene", { val: null, ack: true });
        }
      }
      this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
    } else {
      this.log.info(`state ${id} deleted`);
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new Knconnect(options);
} else {
  (() => new Knconnect())();
}
//# sourceMappingURL=main.js.map

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
let accessToken;
class Knconnect extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: "knconnect"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  async onReady() {
    const login = await import_axios.default.post(
      `${BASE_URL}/userCenter/user/login`,
      new URLSearchParams({
        loginName: this.config.loginName,
        password: this.config.password,
        appCode: "c62c8a8c-4b35-4783-9168-65b06a12a77d",
        msgId: generateMsgId()
      })
    );
    accessToken = login.data.accessToken;
    const scenes = await import_axios.default.post(
      `${BASE_URL}/userCenter/sceneService/getScenes`,
      new URLSearchParams({
        accessToken,
        msgId: generateMsgId()
      })
    );
    this.log.info("Scenes: " + JSON.stringify(scenes.data));
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
    for (const scene of scenes.data.scenes) {
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
    let result = await this.checkPasswordAsync("admin", "iobroker");
    this.log.info("check user admin pw iobroker: " + result);
    result = await this.checkGroupAsync("admin", "admin");
    this.log.info("check group user admin group admin: " + result);
  }
  onUnload(callback) {
    try {
      callback();
    } catch (e) {
      callback();
    }
  }
  async onStateChange(id, state) {
    if (state) {
      if (id.endsWith(".triggerScene") && state.val !== null) {
        this.log.info(`trigger scene: ${state.val}`);
        await import_axios.default.post(
          `${BASE_URL}/userCenter/sceneService/triggerScene`,
          new URLSearchParams({
            accessToken,
            msgId: generateMsgId(),
            sceneCode: state.val
          })
        );
        this.setState("triggerScene", null);
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

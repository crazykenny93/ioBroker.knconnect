"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var DeviceRule_exports = {};
__export(DeviceRule_exports, {
  DeviceRule: () => DeviceRule
});
module.exports = __toCommonJS(DeviceRule_exports);
class DeviceRule {
  constructor(deviceAlias, deviceLogo, deviceType, mac, targetPosition) {
    this.deviceAlias = deviceAlias;
    this.deviceLogo = deviceLogo;
    this.deviceType = deviceType;
    this.mac = mac;
    this.targetPosition = targetPosition;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DeviceRule
});
//# sourceMappingURL=DeviceRule.js.map

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
var Scene_exports = {};
__export(Scene_exports, {
  Scene: () => Scene
});
module.exports = __toCommonJS(Scene_exports);
class Scene {
  constructor(areaCode, sceneCode, sceneName, rules) {
    this.areaCode = areaCode;
    this.sceneCode = sceneCode;
    this.sceneName = sceneName;
    this.rules = rules;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Scene
});
//# sourceMappingURL=Scene.js.map

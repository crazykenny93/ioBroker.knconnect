import {DeviceRule} from "./DeviceRule";

export class Scene {
    areaCode: string;
    sceneCode: string;
    sceneName: string;
    rules: DeviceRule[];

    constructor(
        areaCode: string,
        sceneCode: string,
        sceneName: string,
        rules: DeviceRule[]
    ) {
        this.areaCode = areaCode;
        this.sceneCode = sceneCode;
        this.sceneName = sceneName;
        this.rules = rules;
    }
}


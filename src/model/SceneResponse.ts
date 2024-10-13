import {Scene} from "./Scene";

export class SceneResponse {
    retCode: string;
    scenes: Scene[];

    constructor(retCode: string, scenes: Scene[]) {
        this.retCode = retCode;
        this.scenes = scenes;
    }
}

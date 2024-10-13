/*
 * Created with @iobroker/create-adapter v2.5.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from "@iobroker/adapter-core";
import axios from "axios";
import {SceneResponse} from "./model/SceneResponse";

const BASE_URL: string = "https://connectoreu.shadeconnector.com:8443";


class Knconnect extends utils.Adapter {

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: "knconnect",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        // this.on("objectChange", this.onObjectChange.bind(this));
        // this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        // Initialize your adapter here

        const generateMsgId = (): string => new Date().toISOString().replace(/[^0-9]/g, "");

        const login = await axios.post(
            `${BASE_URL}/userCenter/user/login`,
            new URLSearchParams({
                loginName: this.config.loginName,
                password: this.config.password,
                appCode: "c62c8a8c-4b35-4783-9168-65b06a12a77d",
                msgId: generateMsgId()
            })
        )

        const accessToken = login.data.accessToken;

        const scenes = await axios.post<SceneResponse>(
            `${BASE_URL}/userCenter/sceneService/getScenes`,
            new URLSearchParams({
                accessToken: accessToken,
                msgId: generateMsgId()
            })
        )

        this.log.info("Scenes: " + JSON.stringify(scenes.data));

        this.setObjectNotExistsAsync("scenes", {
            type: "channel",
            common: {
                name: "scenes",
            },
            native: {},
        });

        this.setObjectNotExistsAsync("devices", {
            type: "channel",
            common: {
                name: "devices",
            },
            native: {},
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
        })

        for (const scene of scenes.data.scenes) {
            this.setObjectNotExists(`scenes.${scene.sceneCode}`, {
                type: "channel",
                common: {
                    name: scene.sceneCode
                },
                native: {},
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
            })

            this.setState(`scenes.${scene.sceneCode}.name`, scene.sceneName);
        }

        // In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
        this.subscribeStates("triggerScene");
        // You can also add a subscription for multiple states. The following line watches all states starting with "lights."
        // this.subscribeStates("lights.*");
        // Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
        // this.subscribeStates("*");


        // examples for the checkPassword/checkGroup functions
        let result = await this.checkPasswordAsync("admin", "iobroker");
        this.log.info("check user admin pw iobroker: " + result);

        result = await this.checkGroupAsync("admin", "admin");
        this.log.info("check group user admin group admin: " + result);
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    private onUnload(callback: () => void): void {
        try {
            // Here you must clear all timeouts or intervals that may still be active
            // clearTimeout(timeout1);
            // clearTimeout(timeout2);
            // ...
            // clearInterval(interval1);

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
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (state) {
            // The state was changed
            if (id.endsWith(".triggerScene")) {
                //Trigger Scene here
            }
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }

}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Knconnect(options);
} else {
    // otherwise start the instance directly
    (() => new Knconnect())();
}

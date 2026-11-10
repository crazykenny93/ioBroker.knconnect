/*
 * Created with @iobroker/create-adapter v2.5.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from "@iobroker/adapter-core";
import axios from "axios";
import {SceneResponse} from "./model/SceneResponse";

const BASE_URL: string = "https://connectoreu.shadeconnector.com:8443";

const generateMsgId = (): string => new Date().toISOString().replace(/[^0-9]/g, "");

class Knconnect extends utils.Adapter {
    private accessToken = "";
    private loginPromise?: Promise<void>;

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

    private async requestAccessToken(): Promise<void> {
        const login = await axios.post(
            `${BASE_URL}/userCenter/user/login`,
            new URLSearchParams({
                loginName: this.config.loginName,
                password: this.config.password,
                appCode: "c62c8a8c-4b35-4783-9168-65b06a12a77d",
                msgId: generateMsgId()
            })
        );

        const token = login.data?.accessToken;
        if (typeof token !== "string" || token.trim() === "") {
            throw new Error("KN Connect login returned no access token");
        }
        this.accessToken = token;
    }

    private async login(): Promise<void> {
        // Concurrent commands share one login instead of invalidating each other's token.
        if (!this.loginPromise) {
            this.loginPromise = this.requestAccessToken().finally(() => {
                this.loginPromise = undefined;
            });
        }
        await this.loginPromise;
    }

    private async authenticatedPost<T>(path: string, params: Record<string, string> = {}): Promise<T> {
        if (!this.accessToken) await this.login();

        for (let attempt = 0; attempt < 2; attempt++) {
            const token = this.accessToken;
            try {
                const response = await axios.post<T & { retCode?: string }>(
                    `${BASE_URL}${path}`,
                    new URLSearchParams({ ...params, accessToken: token, msgId: generateMsgId() })
                );
                // The cloud reports token errors in an HTTP 200 response as well.
                if (String(response.data?.retCode) !== "20108") return response.data;
            } catch (error) {
                const status = (error as { response?: { status?: number } } | null)?.response?.status;
                // Never repeat commands after timeouts or other ambiguous failures.
                if (status !== 401) throw error;
            }

            if (attempt === 1) {
                if (this.accessToken === token) this.accessToken = "";
                throw new Error("KN Connect rejected the renewed access token");
            }

            this.log.info("KN Connect token rejected; renewing login and retrying once.");
            // A concurrent request may already have obtained a new token.
            if (this.accessToken === token) await this.login();
        }
        throw new Error("KN Connect authentication failed");
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        let scenes: SceneResponse;
        try {
            await this.login();
            scenes = await this.authenticatedPost<SceneResponse>("/userCenter/sceneService/getScenes");
        } catch {
            // Axios errors can contain the request body, including credentials/tokens.
            this.log.error("KN Connect login or scene loading failed. Check credentials and cloud availability.");
            return;
        }

        this.log.info("Scenes: " + JSON.stringify(scenes));

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

        for (const scene of scenes.scenes) {
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
        const passwordResult = await this.checkPasswordAsync("admin", "iobroker");
        this.log.info("check user admin pw iobroker: " + passwordResult);

        const groupResult = await this.checkGroupAsync("admin", "admin");
        this.log.info("check group user admin group admin: " + groupResult);
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
    private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
        if (state) {
            // The state was changed
            if (id.endsWith(".triggerScene") && !state.ack && typeof state.val === "string" && state.val.trim() !== "") {
                this.log.info(`trigger scene: ${state.val}`);
                try {
                    await this.authenticatedPost("/userCenter/sceneService/triggerScene", {
                        sceneCode: state.val,
                    });
                } catch {
                    this.log.error("KN Connect scene could not be triggered. Check credentials and cloud availability.");
                } finally {
                    this.setState("triggerScene", { val: null, ack: true });
                }
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

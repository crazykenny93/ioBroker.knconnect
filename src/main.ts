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
                if (String(response.data?.retCode) !== "20108") {
                    if (String(response.data?.retCode) !== "20000") throw new Error("KN Connect cloud request failed");
                    return response.data;
                }
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

    private readonly sceneCodes = new Set<string>();
    private readonly devices = new Map<string, { mac: string; deviceType: string }>();
    private readonly roomCodes = new Set<string>();

    private async channel(id: string, name: string): Promise<void> {
        await this.setObjectNotExistsAsync(id, { type: "channel", common: { name }, native: {} });
        await this.extendObjectAsync(id, { common: { name } });
    }

    private async state(id: string, common: ioBroker.StateCommon): Promise<void> {
        await this.setObjectNotExistsAsync(id, { type: "state", common, native: {} });
    }

    private async button(id: string, name: string): Promise<void> {
        await this.state(id, { name, type: "boolean", role: "button", read: false, write: true, def: false });
    }

    private async controls(id: string): Promise<void> {
        for (const action of ["open", "close", "stop"]) await this.button(`${id}.${action}`, action);
        await this.state(`${id}.targetPosition`, {
            name: "Target position (0 = open, 100 = closed)", type: "number", role: "level.blind",
            read: true, write: true, min: 0, max: 100, unit: "%",
        });
    }

    private async onReady(): Promise<void> {
        try {
            await this.login();
        } catch {
            this.log.error("KN Connect login failed. Check credentials and cloud availability.");
            return;
        }
        await this.state("triggerScene", {
            name: "Trigger scene by code", type: "string", role: "text", read: true, write: true,
        });
        this.subscribeStates("triggerScene");
        // Each inventory can fail independently without disabling the other controls.
        const results = await Promise.allSettled([this.loadScenes(), this.loadDevices(), this.loadRooms()]);
        const names = ["scene", "device", "room"];
        results.forEach((result, index) => {
            if (result.status === "rejected") this.log.error(`KN Connect ${names[index]} loading failed.`);
        });
    }

    private async loadScenes(): Promise<void> {
        const scenes = await this.authenticatedPost<SceneResponse>("/userCenter/sceneService/getScenes");
        if (!Array.isArray(scenes.scenes)) throw new Error("Invalid scene list");
        await this.channel("scenes", "Scenes");
        for (const scene of scenes.scenes) {
            if (!this.validId(scene.sceneCode) || typeof scene.sceneName !== "string") continue;
            this.sceneCodes.add(scene.sceneCode);
            const id = `scenes.${scene.sceneCode}`;
            await this.channel(id, scene.sceneName);
            await this.state(`${id}.name`, { name: "Name", type: "string", role: "text", read: true, write: false });
            await this.setStateAsync(`${id}.name`, { val: scene.sceneName, ack: true });
            await this.button(`${id}.trigger`, "Trigger scene");
        }
        this.subscribeStates("scenes.*.trigger");
    }

    private validId(value: unknown): value is string {
        return typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);
    }

    private async loadDevices(): Promise<void> {
        type Device = { mac: string; deviceType: string; deviceAlias: string; childs?: Device[] };
        const response = await this.authenticatedPost<{ devices: Device[] }>("/userCenter/deviceService/listWithSlaves");
        if (!Array.isArray(response.devices)) throw new Error("Invalid device list");
        await this.channel("devices", "Blinds");
        const visit = async (devices: Device[]): Promise<void> => {
            for (const device of devices) {
                if (this.validId(device.mac) && ["10000000", "22000000", "22000002", "22000005"].includes(device.deviceType)) {
                    this.devices.set(device.mac, { mac: device.mac, deviceType: device.deviceType });
                    await this.channel(`devices.${device.mac}`, device.deviceAlias || device.mac);
                    await this.controls(`devices.${device.mac}`);
                }
                if (Array.isArray(device.childs)) await visit(device.childs);
            }
        };
        await visit(response.devices);
        this.subscribeStates("devices.*");
    }

    private async loadRooms(): Promise<void> {
        type Area = { areaCode: string; areaName: string; areaLevel: number; childAreas?: Area[] };
        const response = await this.authenticatedPost<{ areas: Area[] }>("/userCenter/areaService/getAreas");
        if (!Array.isArray(response.areas)) throw new Error("Invalid room list");
        await this.channel("rooms", "Rooms");
        const visit = async (areas: Area[]): Promise<void> => {
            for (const area of areas) {
                if (area.areaLevel === 3 && this.validId(area.areaCode)) {
                    this.roomCodes.add(area.areaCode);
                    const id = `rooms.${area.areaCode}`;
                    await this.channel(id, area.areaName || area.areaCode);
                    await this.state(`${id}.deviceIds`, {
                        name: "Assigned blind IDs (JSON array)", type: "string", role: "json", read: true, write: true, def: "[]",
                    });
                    // Never overwrite an existing assignment when the adapter restarts.
                    if (!(await this.getStateAsync(`${id}.deviceIds`))) {
                        await this.setStateAsync(`${id}.deviceIds`, { val: "[]", ack: true });
                    }
                    await this.controls(id);
                }
                if (Array.isArray(area.childAreas)) await visit(area.childAreas);
            }
        };
        await visit(response.areas);
        this.subscribeStates("rooms.*");
    }

    private parseMembers(value: ioBroker.StateValue | undefined): string[] {
        if (typeof value !== "string") throw new Error("Invalid room assignment");
        const members: unknown = JSON.parse(value);
        if (!Array.isArray(members) || !members.every(id => typeof id === "string" && this.devices.has(id))) {
            throw new Error("Unknown blind in room assignment");
        }
        return [...new Set(members as string[])];
    }

    private async deviceCommand(deviceId: string, params: Record<string, string>): Promise<void> {
        const device = this.devices.get(deviceId);
        if (!device) throw new Error("Unknown blind");
        await this.authenticatedPost("/userCenter/deviceService/deviceControl", { ...device, ...params });
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

    private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
        if (!state || state.ack || !id.startsWith(`${this.namespace}.`)) return;
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
        if (extra !== undefined) return;
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
        if (!(kind === "devices" && this.devices.has(code)) && !(kind === "rooms" && this.roomCodes.has(code))) return;
        if (kind === "rooms" && action === "deviceIds") {
            try {
                const members = this.parseMembers(state.val);
                await this.setStateAsync(relative, { val: JSON.stringify(members), ack: true });
            } catch {
                this.log.error("KN Connect room assignment must be a JSON array of discovered blind IDs.");
            }
            return;
        }
        const operations: Record<string, string> = { open: "1", close: "0", stop: "2" };
        const isButton = Object.prototype.hasOwnProperty.call(operations, action);
        if (isButton ? state.val !== true : action !== "targetPosition" || typeof state.val !== "number" ||
            !Number.isFinite(state.val) || state.val < 0 || state.val > 100) return;
        const params: Record<string, string> = isButton ? { operation: operations[action] } : { targetPosition: String(state.val) };
        try {
            const members = kind === "devices" ? [code] : this.parseMembers((await this.getStateAsync(`rooms.${code}.deviceIds`))?.val);
            if (!members.length) throw new Error("Room has no assigned blinds");
            const results = await Promise.allSettled(members.map(member => this.deviceCommand(member, params)));
            if (results.some(result => result.status === "rejected")) throw new Error("Blind command failed");
            if (!isButton) await this.setStateAsync(relative, { val: state.val, ack: true });
        } catch {
            this.log.error("KN Connect blind command failed. Check room assignment, credentials and cloud availability.");
        } finally {
            if (isButton) await this.setStateAsync(relative, { val: false, ack: true });
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

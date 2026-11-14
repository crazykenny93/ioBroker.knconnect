import { expect } from "chai";
import { EventEmitter } from "events";
import { beforeEach, describe, it } from "mocha";
import proxyquire from "proxyquire";
import sinon from "sinon";

const BASE_URL = "https://connectoreu.shadeconnector.com:8443";
const tokenError = { data: { retCode: "20108", retMsg: "TOKEN异常!" } };

class AdapterStub extends EventEmitter {
    namespace = "knconnect.0";
    extendObjectAsync = sinon.stub().resolves();
    getStateAsync = sinon.stub().resolves(null);
    setStateAsync = sinon.stub().resolves();
    config = { loginName: "test-user", password: "test-password" };
    log = { info: sinon.spy(), warn: sinon.spy(), error: sinon.spy() };
    setObjectNotExistsAsync = sinon.stub().resolves();
    setObjectNotExists = sinon.stub();
    setState = sinon.stub();
    subscribeStates = sinon.stub();
    checkPasswordAsync = sinon.stub().resolves(false);
    checkGroupAsync = sinon.stub().resolves(false);
}

describe("KN Connect token renewal", () => {
    let post: sinon.SinonStub;
    let adapter: AdapterStub;

    async function ready(): Promise<void> {
        await adapter.listeners("ready")[0]();
    }

    async function trigger(sceneCode = "blinds-down", ack = false): Promise<void> {
        await adapter.listeners("stateChange")[0]("knconnect.0.triggerScene", {
            val: sceneCode,
            ack,
        });
    }

    function sent(index: number): URLSearchParams {
        return post.getCall(index).args[1];
    }

    beforeEach(() => {
        post = sinon.stub();
        post.onCall(0).resolves({ data: { accessToken: "old-token" } });
        post.onCall(1).resolves({ data: { retCode: "20000", scenes: [] } });
        const createAdapter = proxyquire.noCallThru().load("./main", {
            "@iobroker/adapter-core": { Adapter: AdapterStub },
            axios: { post: (url: string, params: URLSearchParams) => {
                if (url.endsWith("/getAreas")) return Promise.resolve({ data: { retCode: "20000", areas: [] } });
                if (url.endsWith("/listWithSlaves")) return Promise.resolve({ data: { retCode: "20000", devices: [] } });
                return post(url, params);
            } },
        });
        adapter = createAdapter();
    });

    it("uses the current token without another login for successful commands", async () => {
        post.onCall(2).resolves({ data: { retCode: "20000" } });
        await ready();
        await trigger();
        expect(post.callCount).to.equal(3);
        expect(sent(2).get("accessToken")).to.equal("old-token");
        expect(sent(2).get("sceneCode")).to.equal("blinds-down");
    });

    for (const failure of ["body", "http"] as const) {
        it(`logs in again and retries the same scene after a ${failure} token error`, async () => {
            if (failure === "body") {
                post.onCall(2).resolves(tokenError);
            } else {
                post.onCall(2).rejects({ response: { status: 401 } });
            }
            post.onCall(3).resolves({ data: { accessToken: "new-token" } });
            post.onCall(4).resolves({ data: { retCode: "20000" } });
            post.onCall(5).resolves({ data: { retCode: "20000" } });
            await ready();
            await trigger();
            expect(post.callCount).to.equal(5);
            expect(post.getCall(3).args[0]).to.equal(`${BASE_URL}/userCenter/user/login`);
            expect(sent(3).get("loginName")).to.equal("test-user");
            expect(sent(3).get("password")).to.equal("test-password");
            expect(sent(4).get("accessToken")).to.equal("new-token");
            expect(sent(4).get("sceneCode")).to.equal("blinds-down");
            await trigger("blinds-up");
            expect(post.callCount).to.equal(6);
            expect(sent(5).get("accessToken")).to.equal("new-token");
        });
    }

    it("also renews a token rejected while loading scenes at startup", async () => {
        post.onCall(1).resolves(tokenError);
        post.onCall(2).resolves({ data: { accessToken: "new-token" } });
        post.onCall(3).resolves({ data: { retCode: "20000", scenes: [] } });
        await ready();
        expect(post.callCount).to.equal(4);
        expect(sent(3).get("accessToken")).to.equal("new-token");
        expect(adapter.subscribeStates.calledWith("triggerScene")).to.equal(true);
    });

    it("stops after one retry if the renewed token is rejected too", async () => {
        post.onCall(2).resolves(tokenError);
        post.onCall(3).resolves({ data: { accessToken: "new-token" } });
        post.onCall(4).resolves(tokenError);
        await ready();
        await trigger();
        expect(post.callCount).to.equal(5);
        expect(adapter.log.error.calledOnce).to.equal(true);
    });

    it("does not retry a scene after an ambiguous network failure", async () => {
        post.onCall(2).rejects(new Error("timeout"));
        await ready();
        await trigger();
        expect(post.callCount).to.equal(3);
        expect(adapter.log.error.calledOnce).to.equal(true);
    });

    it("does not send a scene when renewal returns no usable token", async () => {
        post.onCall(2).resolves(tokenError);
        post.onCall(3).resolves({ data: { retCode: "login-failed" } });
        await ready();
        await trigger();
        expect(post.callCount).to.equal(4);
        expect(adapter.log.error.calledOnce).to.equal(true);
    });

    it("does not log credentials or tokens when login fails", async () => {
        post.onCall(2).resolves(tokenError);
        post.onCall(3).rejects(new Error("test-password old-token"));
        await ready();
        await trigger();
        expect(adapter.log.error.calledOnce).to.equal(true);
        const logs = JSON.stringify(adapter.log.error.args);
        expect(logs).not.to.contain("test-password");
        expect(logs).not.to.contain("old-token");
    });

    it("can renew again on a later command after a failed login", async () => {
        post.onCall(2).resolves(tokenError);
        post.onCall(3).rejects(new Error("login unavailable"));
        post.onCall(4).resolves(tokenError);
        post.onCall(5).resolves({ data: { accessToken: "new-token" } });
        post.onCall(6).resolves({ data: { retCode: "20000" } });
        await ready();
        await trigger();
        await trigger("blinds-up");
        expect(post.callCount).to.equal(7);
        expect(sent(6).get("accessToken")).to.equal("new-token");
        expect(sent(6).get("sceneCode")).to.equal("blinds-up");
        expect(adapter.log.error.calledOnce).to.equal(true);
    });

    it("reuses an already renewed token when an older request fails late", async () => {
        let rejectOldToken!: (value: unknown) => void;
        post.onCall(2).returns(new Promise(resolve => { rejectOldToken = resolve; }));
        post.onCall(3).resolves(tokenError);
        post.onCall(4).resolves({ data: { accessToken: "new-token" } });
        post.onCall(5).resolves({ data: { retCode: "20000" } });
        post.onCall(6).resolves({ data: { retCode: "20000" } });
        await ready();
        const oldCommand = trigger("blinds-down");
        await trigger("blinds-up");
        rejectOldToken(tokenError);
        await oldCommand;
        expect(post.callCount).to.equal(7);
        expect(sent(6).get("accessToken")).to.equal("new-token");
        expect(sent(6).get("sceneCode")).to.equal("blinds-down");
    });

    it("shares one renewal between simultaneous rejected commands", async () => {
        let finishLogin!: (value: unknown) => void;
        const login = new Promise(resolve => { finishLogin = resolve; });
        const scenes: string[] = [];
        let loginCount = 0;
        post.resetBehavior();
        post.callsFake(async (url: string, params: URLSearchParams) => {
            if (url.endsWith("/login")) {
                loginCount++;
                return loginCount === 1 ? { data: { accessToken: "old-token" } } : login;
            }
            if (url.endsWith("/getScenes")) return { data: { retCode: "20000", scenes: [] } };
            if (params.get("accessToken") === "old-token") return tokenError;
            scenes.push(params.get("sceneCode")!);
            return { data: { retCode: "20000" } };
        });
        await ready();
        const commands = Promise.all([trigger("blinds-down"), trigger("blinds-up")]);
        await new Promise(resolve => setImmediate(resolve));
        expect(loginCount).to.equal(2);
        finishLogin({ data: { accessToken: "new-token" } });
        await commands;
        expect(loginCount).to.equal(2);
        expect(scenes).to.have.members(["blinds-down", "blinds-up"]);
    });

    it("ignores acknowledged scene states", async () => {
        await ready();
        await trigger("blinds-down", true);
        expect(post.callCount).to.equal(2);
    });
});


describe("KN Connect scene, device and room controls", () => {
    let adapter: AdapterStub;
    let post: sinon.SinonStub;
    let createAdapter: () => AdapterStub;
    const devices = [
        { mac: "AABBCCDDEEFF0001", deviceType: "10000000", deviceAlias: "Window", childs: [] },
        { mac: "AABBCCDDEEFF0002", deviceType: "10000000", deviceAlias: "Door", childs: [] },
    ];
    const room = "house-zone-living";

    async function change(id: string, val: unknown, ack = false): Promise<void> {
        await adapter.listeners("stateChange")[0](`knconnect.0.${id}`, { val, ack });
    }

    beforeEach(async () => {
        post = sinon.stub().callsFake(async (url: string) => {
            if (url.endsWith("/login")) return { data: { accessToken: "token" } };
            if (url.endsWith("/getScenes")) return { data: { retCode: "20000", scenes: [
                { sceneCode: "morning", sceneName: "Morning", areaCode: "house", rules: [] },
            ] } };
            if (url.endsWith("/getAreas")) return { data: { retCode: "20000", areas: [
                { areaCode: "house", areaLevel: 1, areaName: "Home", childAreas: [
                    { areaCode: "house-zone", areaLevel: 2, areaName: "Zone", childAreas: [
                        { areaCode: room, areaLevel: 3, areaName: "Living room" },
                    ] },
                ] },
            ] } };
            if (url.endsWith("/listWithSlaves")) return { data: { retCode: "20000", devices: [
                { mac: "AABBCCDDEEFF", deviceType: "02000001", deviceAlias: "Hub", childs: devices },
            ] } };
            return { data: { retCode: "20000" } };
        });
        createAdapter = proxyquire.noCallThru().load("./main", {
            "@iobroker/adapter-core": { Adapter: AdapterStub }, axios: { post },
        });
        adapter = createAdapter();
        await adapter.listeners("ready")[0]();
    });

    function commands(path: string) {
        return post.getCalls().filter(c => c.args[0].endsWith(path)).map(c => c.args[1] as URLSearchParams);
    }

    it("discovers named scenes, rooms and child controls without operating the hub", () => {
        expect(adapter.extendObjectAsync.calledWith("scenes.morning", sinon.match({ common: { name: "Morning" } }))).to.equal(true);
        expect(adapter.setObjectNotExistsAsync.calledWith(`rooms.${room}.deviceIds`)).to.equal(true);
        expect(adapter.setObjectNotExistsAsync.calledWith("rooms.house.deviceIds")).to.equal(false);
        expect(adapter.setObjectNotExistsAsync.calledWith("devices.AABBCCDDEEFF0001.open")).to.equal(true);
        expect(adapter.setObjectNotExistsAsync.calledWith("devices.AABBCCDDEEFF.open")).to.equal(false);
        expect(adapter.setStateAsync.calledWith("scenes.morning.name", { val: "Morning", ack: true })).to.equal(true);
        expect(commands("/deviceControl")).to.have.length(0);
    });

    it("triggers a discovered scene button once and resets it", async () => {
        await change("scenes.morning.trigger", true);
        expect(commands("/triggerScene").map(p => p.get("sceneCode"))).to.deep.equal(["morning"]);
        expect(adapter.setStateAsync.calledWith("scenes.morning.trigger", { val: false, ack: true })).to.equal(true);
        await change("scenes.morning.trigger", false);
        await change("scenes.morning.trigger", true, true);
        await change("scenes.missing.trigger", true);
        expect(commands("/triggerScene")).to.have.length(1);
    });

    it("sends open, close, stop and validated target positions to a child only", async () => {
        for (const action of ["open", "close", "stop"]) await change(`devices.AABBCCDDEEFF0001.${action}`, true);
        await change("devices.AABBCCDDEEFF0001.targetPosition", 42);
        for (const invalid of [-1, 101, "50", null]) await change("devices.AABBCCDDEEFF0001.targetPosition", invalid);
        await change("devices.AABBCCDDEEFF.open", true);
        const sent = commands("/deviceControl");
        expect(sent.map(p => p.get("operation"))).to.deep.equal(["1", "0", "2", null]);
        expect(sent.map(p => p.get("mac"))).to.deep.equal(Array(4).fill("AABBCCDDEEFF0001"));
        expect(sent[3].get("targetPosition")).to.equal("42");
        expect(sent[3].get("deviceType")).to.equal("10000000");
    });

    it("uses persisted room membership, removes duplicates and sends only to those devices", async () => {
        adapter.getStateAsync.withArgs(`rooms.${room}.deviceIds`).resolves({ val: '["AABBCCDDEEFF0002","AABBCCDDEEFF0002"]', ack: true });
        await change(`rooms.${room}.close`, true);
        expect(commands("/deviceControl").map(p => p.get("mac"))).to.deep.equal(["AABBCCDDEEFF0002"]);
    });

    it("rejects invalid or unknown room members before sending any command", async () => {
        for (const val of ['["AABBCCDDEEFF0001","unknown"]', "[]", "{}", "broken"]) {
            adapter.getStateAsync.withArgs(`rooms.${room}.deviceIds`).resolves({ val, ack: true });
            await change(`rooms.${room}.open`, true);
        }
        await change("rooms.unknown.open", true);
        expect(commands("/deviceControl")).to.have.length(0);
    });

    it("persists only valid room assignments without moving a blind or overwriting them on startup", async () => {
        await change(`rooms.${room}.deviceIds`, '["AABBCCDDEEFF0001","AABBCCDDEEFF0001"]');
        expect(adapter.setStateAsync.calledWith(`rooms.${room}.deviceIds`, { val: '["AABBCCDDEEFF0001"]', ack: true })).to.equal(true);
        adapter.setStateAsync.resetHistory();
        adapter.getStateAsync.withArgs(`rooms.${room}.deviceIds`).resolves({ val: '["AABBCCDDEEFF0001"]', ack: true });
        await adapter.listeners("ready")[0]();
        expect(adapter.setStateAsync.calledWith(`rooms.${room}.deviceIds`)).to.equal(false);
        expect(commands("/deviceControl")).to.have.length(0);
    });

    it("keeps devices, rooms and the legacy trigger usable when scene discovery fails", async () => {
        post.withArgs(`${BASE_URL}/userCenter/sceneService/getScenes`).rejects(new Error("offline"));
        adapter = createAdapter();
        await adapter.listeners("ready")[0]();
        await change("devices.AABBCCDDEEFF0001.open", true);
        await change("triggerScene", "known-scene");
        expect(commands("/deviceControl").map(p => p.get("mac"))).to.deep.equal(["AABBCCDDEEFF0001"]);
        expect(commands("/triggerScene").map(p => p.get("sceneCode"))).to.deep.equal(["known-scene"]);
        expect(adapter.setObjectNotExistsAsync.calledWith(`rooms.${room}.deviceIds`)).to.equal(true);
        expect(adapter.subscribeStates.calledWith("triggerScene")).to.equal(true);
    });

    it("keeps scenes usable when room discovery fails", async () => {
        post.withArgs(`${BASE_URL}/userCenter/areaService/getAreas`).rejects(new Error("offline token"));
        await adapter.listeners("ready")[0]();
        await change("scenes.morning.trigger", true);
        expect(commands("/triggerScene").map(p => p.get("sceneCode"))).to.deep.equal(["morning"]);
        expect(JSON.stringify(adapter.log.error.args)).not.to.contain("offline token");
    });

    it("renews an expired token for device controls and does not retry network errors", async () => {
        let attempts = 0;
        post.withArgs(`${BASE_URL}/userCenter/deviceService/deviceControl`).callsFake(async () => {
            attempts++;
            return attempts === 1 ? tokenError : { data: { retCode: "20000" } };
        });
        await change("devices.AABBCCDDEEFF0001.open", true);
        expect(commands("/deviceControl")).to.have.length(2);
        post.withArgs(`${BASE_URL}/userCenter/deviceService/deviceControl`).rejects(new Error("timeout"));
        await change("devices.AABBCCDDEEFF0001.close", true);
        expect(commands("/deviceControl")).to.have.length(3);
    });

    it("reports body-level command errors and still resets buttons", async () => {
        post.withArgs(`${BASE_URL}/userCenter/deviceService/deviceControl`).resolves({ data: { retCode: "20012" } });
        await change("devices.AABBCCDDEEFF0001.open", true);
        expect(adapter.log.error.calledOnce).to.equal(true);
        expect(adapter.setStateAsync.calledWith("devices.AABBCCDDEEFF0001.open", { val: false, ack: true })).to.equal(true);
    });
});

import { expect } from "chai";
import { EventEmitter } from "events";
import { beforeEach, describe, it } from "mocha";
import proxyquire from "proxyquire";
import sinon from "sinon";

const BASE_URL = "https://connectoreu.shadeconnector.com:8443";
const tokenError = { data: { retCode: "20108", retMsg: "TOKEN异常!" } };

class AdapterStub extends EventEmitter {
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
        post.onCall(1).resolves({ data: { retCode: "00000", scenes: [] } });
        const createAdapter = proxyquire.noCallThru().load("./main", {
            "@iobroker/adapter-core": { Adapter: AdapterStub },
            axios: { post },
        });
        adapter = createAdapter();
    });

    it("uses the current token without another login for successful commands", async () => {
        post.onCall(2).resolves({ data: { retCode: "00000" } });
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
            post.onCall(4).resolves({ data: { retCode: "00000" } });
            post.onCall(5).resolves({ data: { retCode: "00000" } });
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
        post.onCall(3).resolves({ data: { retCode: "00000", scenes: [] } });
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
        post.onCall(6).resolves({ data: { retCode: "00000" } });
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
        post.onCall(5).resolves({ data: { retCode: "00000" } });
        post.onCall(6).resolves({ data: { retCode: "00000" } });
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
            if (url.endsWith("/getScenes")) return { data: { scenes: [] } };
            if (params.get("accessToken") === "old-token") return tokenError;
            scenes.push(params.get("sceneCode")!);
            return { data: { retCode: "00000" } };
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

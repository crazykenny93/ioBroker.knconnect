export class DeviceRule {
    deviceAlias: string;
    deviceLogo: string;
    deviceType: string;
    mac: string;
    targetPosition: number;

    constructor(
        deviceAlias: string,
        deviceLogo: string,
        deviceType: string,
        mac: string,
        targetPosition: number
    ) {
        this.deviceAlias = deviceAlias;
        this.deviceLogo = deviceLogo;
        this.deviceType = deviceType;
        this.mac = mac;
        this.targetPosition = targetPosition;
    }
}

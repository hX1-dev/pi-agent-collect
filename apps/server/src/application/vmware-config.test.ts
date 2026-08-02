import assert from "node:assert/strict";
import test from "node:test";
import { parseVmwareFusionConfig } from "../config.js";

const configNow = () => new Date("2026-07-31T13:00:00.000Z");

test("keeps VMware lifecycle disabled unless explicit configuration is complete", () => {
  assert.equal(parseVmwareFusionConfig({}), undefined);
  assert.equal(parseVmwareFusionConfig({
    VMWARE_FUSION_ACTIONS_ARMED: "false"
  }), undefined);
  assert.throws(
    () => parseVmwareFusionConfig({
      VMWARE_FUSION_VMRUN_PATH: "/Applications/VMware Fusion.app/vmrun"
    }),
    /requires VMRUN_PATH, STUDIO_ID, INSTANCE_ID, and VMX_PATH together/
  );
  assert.throws(
    () => parseVmwareFusionConfig({
      VMWARE_FUSION_ACTIONS_ARMED: "true"
    }),
    /cannot be armed without one complete configured target/
  );
  assert.throws(
    () => parseVmwareFusionConfig({
      VMWARE_FUSION_ACTIONS_ARMED: "yes"
    }),
    /must be exactly true or false/
  );
});

test("parses one exact VMware Fusion target as read-only by default", () => {
  assert.deepEqual(parseVmwareFusionConfig({
    VMWARE_FUSION_VMRUN_PATH: " /Applications/VMware Fusion.app/Contents/Library/vmrun ",
    VMWARE_FUSION_STUDIO_ID: " studio-github-research ",
    VMWARE_FUSION_INSTANCE_ID: " instance-research-disposable ",
    VMWARE_FUSION_VMX_PATH: " /VMs/Disposable Studio/Disposable Studio.vmx "
  }), {
    vmrunExecutablePath: "/Applications/VMware Fusion.app/Contents/Library/vmrun",
    studioId: "studio-github-research",
    studioInstanceId: "instance-research-disposable",
    vmxPath: "/VMs/Disposable Studio/Disposable Studio.vmx",
    actionsArmed: false,
    actionsArmedUntil: null
  });
});

test("arms one complete VMware Fusion target only for a bounded future window", () => {
  assert.deepEqual(parseVmwareFusionConfig({
    VMWARE_FUSION_VMRUN_PATH: "/Applications/VMware Fusion.app/Contents/Library/vmrun",
    VMWARE_FUSION_STUDIO_ID: "studio-github-research",
    VMWARE_FUSION_INSTANCE_ID: "instance-research-disposable",
    VMWARE_FUSION_VMX_PATH: "/VMs/Disposable Studio/Disposable Studio.vmx",
    VMWARE_FUSION_ACTIONS_ARMED: "true",
    VMWARE_FUSION_ACTIONS_ARMED_UNTIL: "2026-07-31T21:15:00+08:00"
  }, configNow), {
    vmrunExecutablePath: "/Applications/VMware Fusion.app/Contents/Library/vmrun",
    studioId: "studio-github-research",
    studioInstanceId: "instance-research-disposable",
    vmxPath: "/VMs/Disposable Studio/Disposable Studio.vmx",
    actionsArmed: true,
    actionsArmedUntil: "2026-07-31T13:15:00.000Z"
  });
});

test("rejects missing, expired, or overlong VMware action windows", () => {
  const target = {
    VMWARE_FUSION_VMRUN_PATH: "/Applications/VMware Fusion.app/Contents/Library/vmrun",
    VMWARE_FUSION_STUDIO_ID: "studio-github-research",
    VMWARE_FUSION_INSTANCE_ID: "instance-research-disposable",
    VMWARE_FUSION_VMX_PATH: "/VMs/Disposable Studio/Disposable Studio.vmx"
  };
  assert.throws(
    () => parseVmwareFusionConfig({
      ...target,
      VMWARE_FUSION_ACTIONS_ARMED: "true"
    }, configNow),
    /requires ACTIONS_ARMED_UNTIL/
  );
  assert.throws(
    () => parseVmwareFusionConfig({
      ...target,
      VMWARE_FUSION_ACTIONS_ARMED: "false",
      VMWARE_FUSION_ACTIONS_ARMED_UNTIL: "2026-07-31T13:15:00.000Z"
    }, configNow),
    /requires ACTIONS_ARMED=true/
  );
  assert.throws(
    () => parseVmwareFusionConfig({
      ...target,
      VMWARE_FUSION_ACTIONS_ARMED: "true",
      VMWARE_FUSION_ACTIONS_ARMED_UNTIL: "2026-07-31T13:00:00.000Z"
    }, configNow),
    /must be in the future/
  );
  assert.throws(
    () => parseVmwareFusionConfig({
      ...target,
      VMWARE_FUSION_ACTIONS_ARMED: "true",
      VMWARE_FUSION_ACTIONS_ARMED_UNTIL: "2026-07-31T13:30:00.001Z"
    }, configNow),
    /must not exceed 30 minutes/
  );
});

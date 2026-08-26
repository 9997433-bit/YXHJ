#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { DEFAULT_BUDGETS } from "./lib/budget-controller.mjs";
import { runMockProbe } from "./lib/mock-probe.mjs";
import { runProductionRuntimeProbe } from "./lib/production-runtime-probe.mjs";

const benchDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultScenarioPath = path.join(
  benchDirectory,
  "scenarios",
  "waves-16-19.json",
);
const templatePath = path.join(
  benchDirectory,
  "templates",
  "vfx-budget-report.template.json",
);

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(helpText());
    process.exitCode = 0;
  } else if (options.template) {
    process.stdout.write(await readFile(templatePath, "utf8"));
    process.exitCode = 0;
  } else {
    const scenarioText = await readFile(options.scenarioPath, "utf8");
    const scenario = JSON.parse(scenarioText);
    const budgets = {
      ...DEFAULT_BUDGETS,
      ...options.budgetOverrides,
    };
    if (options.budgetOverrides.targetFps) {
      budgets.frameTimeMs = 1000 / options.budgetOverrides.targetFps;
    }

    const report = runMockProbe({
      scenario,
      budgets,
      scenarioPath: path.relative(process.cwd(), options.scenarioPath),
    });
    const productionRuntime = await runProductionRuntimeProbe();
    attachProductionRuntime(report, productionRuntime);
    const indentation = options.compact ? 0 : 2;
    const output = `${JSON.stringify(report, null, indentation)}\n`;

    if (options.outputPath) {
      await mkdir(path.dirname(options.outputPath), { recursive: true });
      await writeFile(options.outputPath, output, "utf8");
      process.stderr.write(
        `Last Watt VFX report written to ${options.outputPath}\n`,
      );
    } else {
      process.stdout.write(output);
    }
    process.exitCode = report.result.status === "PASS" ? 0 : 1;
  }
} catch (error) {
  process.stderr.write(
    `Last Watt VFX budget probe failed: ${error.stack ?? error.message}\n`,
  );
  process.exitCode = 2;
}

function attachProductionRuntime(report, productionRuntime) {
  const mockPolicyVerified = report.result.budgetControllerVerified;
  const productionRuntimeVerified = productionRuntime.status === "PASS";

  report.schemaVersion = 2;
  report.benchmark.version = "2.0.0";
  report.benchmark.kind = "production-runtime-counters-with-deterministic-demand-model";
  report.result.mockPolicyVerified = mockPolicyVerified;
  report.result.productionRuntimeVerified = productionRuntimeVerified;
  report.result.budgetControllerVerified =
    mockPolicyVerified && productionRuntimeVerified;
  report.result.status = report.result.budgetControllerVerified
    ? "PASS"
    : "FAIL";
  report.productionRuntime = productionRuntime;
  report.notes = [
    "Production runtime checks load VfxBudget and GpuParticleSystem from src/vfx and read their real snapshot, estimated-alive, and exact-alive counters.",
    "The waves 16–19 demand forecast remains deterministic; its allocation policy is retained as a model baseline and is not presented as rendered GPU output.",
    "The production particle probe writes real Three.js buffer attributes headlessly but does not create a WebGL context or verify reference-hardware frame rate.",
    "Node host CPU timing is diagnostic only and must not be used as proof of GTX 1060 or Steam Deck 60fps.",
    "Event and combo burst particles are protected; environment emitters are discarded first.",
    "Point-light requests above eight use additive billboard fallback in the demand model.",
  ];
}

function parseArguments(argumentsList) {
  const options = {
    scenarioPath: defaultScenarioPath,
    outputPath: null,
    compact: false,
    template: false,
    help: false,
    budgetOverrides: {},
  };
  const budgetFlags = {
    "--active-emitters": "activeEmitters",
    "--looping-emitters": "loopingEmitters",
    "--burst-emitters": "burstEmitters",
    "--particles": "gpuParticles",
    "--point-lights": "dynamicPointLights",
    "--target-fps": "targetFps",
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--compact") {
      options.compact = true;
    } else if (argument === "--template") {
      options.template = true;
    } else if (argument === "--scenario") {
      options.scenarioPath = resolvePathValue(argumentsList, ++index, argument);
    } else if (argument === "--out") {
      options.outputPath = resolvePathValue(argumentsList, ++index, argument);
    } else if (budgetFlags[argument]) {
      const value = Number(readValue(argumentsList, ++index, argument));
      if (!Number.isFinite(value) || value <= 0) {
        throw new TypeError(`${argument} requires a positive number.`);
      }
      options.budgetOverrides[budgetFlags[argument]] = value;
    } else {
      throw new TypeError(`Unknown argument "${argument}". Use --help.`);
    }
  }
  return options;
}

function readValue(argumentsList, index, flag) {
  const value = argumentsList[index];
  if (!value || value.startsWith("--")) {
    throw new TypeError(`${flag} requires a value.`);
  }
  return value;
}

function resolvePathValue(argumentsList, index, flag) {
  const value = readValue(argumentsList, index, flag);
  return path.resolve(process.cwd(), value);
}

function helpText() {
  return `Last Watt production VFX counter + demand-model budget probe

Usage:
  node games/last-watt/bench/run.mjs [options]

Options:
  --scenario <path>         Scenario JSON (default: waves 16–19 demand model)
  --out <path>              Write the JSON report instead of stdout
  --compact                 Emit compact JSON
  --template                Print the blank JSON report template
  --active-emitters <n>     Override the 64-emitter redline
  --looping-emitters <n>    Override the 24-looping-emitter redline
  --burst-emitters <n>      Override the 40-burst-emitter redline
  --particles <n>           Override the 20,000-particle redline
  --point-lights <n>        Override the 8-point-light redline
  --target-fps <n>          Set diagnostic frame target (default: 60)
  --help, -h                Show this help

Exit codes:
  0  all budget redlines pass
  1  one or more redlines fail
  2  invalid input or runtime error
`;
}

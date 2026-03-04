import path from "path";
import process from "process";
import { spawnSync } from "child_process";

const targetArg = process.argv[2];

if (!targetArg) {
	console.error(
		'Usage: npm run build:to -- "/absolute/path/to/.obsidian/plugins/<plugin-id>"',
	);
	process.exit(1);
}

const outputPath = path.resolve(targetArg);

const result = spawnSync("npm", ["run", "build"], {
	stdio: "inherit",
	env: {
		...process.env,
		OUTPUT_PATH: outputPath,
	},
});

if (result.status !== 0) {
	process.exit(result.status ?? 1);
}

console.log(`Plugin build copied to: ${outputPath}`);

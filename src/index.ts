import chalk from "chalk";
import { selectTraveltekProcess, travelTekMenu } from "./services/traveltek/menu.js";
import { welcome } from "./helpers/lib.js";
import { servicesMenu } from "./helpers/menu.js";
import { cruiseAppyMenu, selectCruiseAppyProcess } from "./services/cruiseappy/menu.js";
import { runDailyBookingProcessing } from "./services/traveltek/index.js";

(async () => {
	const args = process.argv.slice(2);
	if (args.includes('--help')) {
		console.log(`
		Usage: npm run start [options]

		Options:
		--help		Show help
		`);
		process.exit(0);
	}
	let serviceArg = args.find(arg => arg.startsWith('service='));
	if (serviceArg) {
		const service = serviceArg.split('=')[1].toUpperCase();
		if (service === 'TRAVELTEK' || service === 'CRUISEAPPY') {
			console.clear();
			await welcome();
			if (service === 'TRAVELTEK') {
				const credentials = {
					username: process.env.TRAVELTEK_USERNAME,
					password: process.env.TRAVELTEK_PASSWORD,
				};
				const startDate = new Date().toISOString().split('T')[0];
				const endDate = new Date().toISOString().split('T')[0];

				console.log(`\n${chalk.green(`Running Traveltek Process for ${startDate} to ${endDate} using ${credentials.username} login...`)}`);
				await runDailyBookingProcessing({
					credentials,
					startDate,
					endDate,
				});
			} else if (service === 'CRUISEAPPY') {
				console.log(`\n${chalk.green('Running CruiseAppy Process...')}`);
				// await selectCruiseAppyProcess(await cruiseAppyMenu());
			}
			process.exit(0);
		} else {
			console.log(`\n${chalk.red('Invalid service argument. Exiting...')}`);
			process.exit(1);
		}
	}

	console.clear();
	await welcome();
	const serviceToRun = await servicesMenu();

	if (serviceToRun === 'TRAVELTEK') {
		console.log(`\n${chalk.green('Running Traveltek Process...')}`);
		await selectTraveltekProcess(await travelTekMenu());
	} else if (serviceToRun === 'CRUISEAPPY') {
		console.log(`\n${chalk.green('Running CruiseAppy Process...')}`);
		await selectCruiseAppyProcess(await cruiseAppyMenu());
	} else {
		console.log(`\n${chalk.red('No service selected. Exiting...')}`);
		process
	};
	
})();
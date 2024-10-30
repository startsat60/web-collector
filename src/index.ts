import chalk from "chalk";
import { selectTraveltekProcess, travelTekMenu } from "./services/traveltek/menu.js";
import { processLiveBookings, runDailyBookingProcessing, runHistoricalBookingProcessing, runSpecificBookingProcessing } from "./services/traveltek/index.js";
import { welcome } from "./helpers/lib.js";
import { servicesMenu } from "./helpers/menu.js";
import { runGetCruisesProcess } from "./services/cruiseappy/index.js";
import { cruiseAppyMenu, selectCruiseAppyProcess } from "./services/cruiseappy/menu.js";

(async () => {
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
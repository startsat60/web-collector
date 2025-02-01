import inquirer from "inquirer";
import { createSpinner } from "nanospinner";
import { sleep } from "../../helpers/lib.js";
import { promptForCredentials } from "../../helpers/menu.js";
import { runGetCruiseFromUrlsProcess, runGetCruisesFromSearchProcess } from "./index.js";
import chalk from "chalk";
import { ProcessType } from "./lib.js";

export const availableProcesses = [
  { value: ProcessType.SEARCH_URL, name: 'Get cruises by search URL' },
  { value: ProcessType.SPECIFIC_PRODUCT, name: 'Get specific product by URL' },
];

export const cruiseAppyMenu = async () => {
  let credentials = null,
    bookingUrlsDelimited = null
  ;

  const answers = await inquirer.prompt({
    type: 'list',
    name: 'processToRun',
    message: 'Which process would you like to run?\n',
    choices: availableProcesses,
  });
  const spinner = createSpinner('Preparing...').start();
	await sleep(1000);
  spinner.success({ text: `Preparing...Done` });

  if (
    answers.processToRun === ProcessType.SEARCH_URL
  ) {
    bookingUrlsDelimited = await inquirer.prompt([
      {
        name: 'bookingUrl',
        type: 'input',
        message: 'Enter the search URL:',
        validate: (input) => {
          return input.length > 0 || 'URL cannot be empty';
        },
      },
    ]);
  }

  if (
    answers.processToRun === ProcessType.SPECIFIC_PRODUCT
  ) {
    bookingUrlsDelimited = await inquirer.prompt([
      {
        name: 'bookingUrl',
        type: 'input',
        message: 'Enter the product URLs separated by a comma (or single URL):',
        validate: (input) => {
          return input.length > 0 || 'URL cannot be empty';
        },
      },
    ]);
  }

  return {
    process: answers.processToRun,
    ...bookingUrlsDelimited,
    credentials,
  };
};

export const selectCruiseAppyProcess = async (processToRun) => {
	switch (processToRun.process) {
		case ProcessType.SEARCH_URL:
			console.log(`\n${chalk.green('Getting cruises...')}`);
			await runGetCruisesFromSearchProcess({
        searchUrl: processToRun.bookingUrl,
      });
			break;
    case ProcessType.SPECIFIC_PRODUCT:
			console.log(`\n${chalk.green('Getting cruises...')}`);
			await runGetCruiseFromUrlsProcess({
        productUrls: processToRun.bookingUrl,
      });
			break;
		default:
			break;
	};
};
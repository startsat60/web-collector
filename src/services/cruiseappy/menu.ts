import inquirer from "inquirer";
import { createSpinner } from "nanospinner";
import { sleep } from "../../helpers/lib.js";
import { promptForCredentials } from "../../helpers/menu.js";
import { runGetCruisesProcess } from "./index.js";
import chalk from "chalk";

export enum ProcessType {
  GET_CRUISES = 'GET_CRUISES',
};

export const availableProcesses = [
  { value: ProcessType.GET_CRUISES, name: 'Get all cruises' },
];

export const cruiseAppyMenu = async () => {
  let credentials = null;

  const answers = await inquirer.prompt({
    type: 'list',
    name: 'processToRun',
    message: 'Which process would you like to run?\n',
    choices: availableProcesses,
  });
  const spinner = createSpinner('Preparing...').start();
	await sleep(1000);
  spinner.stop();

  if (
    answers.processToRun === ProcessType.GET_CRUISES
  ) {
    credentials = await promptForCredentials(process.env.CRUISEAPPY_USERNAME);
  }

  return {
    process: answers.processToRun,
    credentials,
  };
};

export const selectCruiseAppyProcess = async (processToRun) => {
	switch (processToRun.process) {
		case ProcessType.GET_CRUISES:
			console.log(`\n${chalk.green('Getting cruises...')}`);
			await runGetCruisesProcess({
				credentials: {
					username: processToRun.credentials.username, 
					password: processToRun.credentials.password
				},
			});
			break;
		default:
			break;
	};
};
import chalk from "chalk";
import inquirer from "inquirer";
import { formatDate } from "./lib.js";

export enum ServiceType {
  TRAVELTEK = 'TRAVELTEK',
  CRUISEAPPY = 'CRUISEAPPY',
}
export const availableServices = [
  { value: ServiceType.TRAVELTEK, name: 'Select from available Traveltek services' },
  { value: ServiceType.CRUISEAPPY, name: 'Select from available CruiseAppy services' },
];

export const promptForDates = async (startDate, endDate?): Promise<{ startDate: string; endDate: string }> => {
  console.log(chalk.yellow('Please enter a date range to continue.'));
  const dateAnswers = await inquirer.prompt([
    {
      name: 'startDate',
      type: 'input',
      message: 'Enter the start date (YYYY-MM-DD):',
      default: () => {
        return startDate;
      },
      validate: (input) => {
        const isValid = /^\d{4}-\d{2}-\d{2}$/.test(input);
        return isValid || 'Please enter a valid date in the format YYYY-MM-DD';
      },
        },
        {
      name: 'endDate',
      type: 'input',
      message: 'Enter the end date (YYYY-MM-DD):',
      default: () => {
        return endDate ?? formatDate();
      },
      validate: (input) => {
        const isValid = /^\d{4}-\d{2}-\d{2}$/.test(input);
        return isValid || 'Please enter a valid date in the format YYYY-MM-DD';
      },
    },
  ]);

  return {
    startDate: dateAnswers.startDate,
    endDate: dateAnswers.endDate,
  };
};

export const promptForCredentials = async (
  username?: string,
  password?: string,
): Promise<{ username: string; password: string }> => {
  console.log(chalk.yellow('This process requires Traveltek credentials to continue.'));
  const credentialAnswers = await inquirer.prompt([
    {
      name: 'username',
      type: 'input',
      default: username ?? process.env.TRAVELTEK_USERNAME,
      message: 'Enter your username:',
      validate: (input) => {
        return input.length > 0 || 'Username cannot be empty';
      },
    },
    {
      name: 'password',
      type: 'password',
      message: 'Enter your password:',
      mask: '*',
//      default: password ?? process.env.TRAVELTEK_PASSWORD,
      validate: (input) => {
        return input.length > 0 || 'Password cannot be empty';
      },
    },
  ]);

  return {
    username: credentialAnswers.username,
    password: credentialAnswers.password,
  };
};

export const servicesMenu = async () => {
  const answers = await inquirer.prompt({
    type: 'list',
    name: 'service',
    message: 'Which service would you like to run?\n',
    choices: availableServices,
  });
  return answers.service;
}

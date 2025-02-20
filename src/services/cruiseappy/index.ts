import { url } from "inspector";
import { launchBrowser, timeout } from "../../helpers/browser.js";
import { Credentials, sleep } from "../../helpers/lib.js";
import { createSpinner } from "nanospinner";
import chalk from "chalk";

const loginUrl = process.env.CRUISEAPPY_LOGIN_URL;

export const doLogin = async (credentials: Credentials, browser, page) => {
	let retryCounter = 1, maxRetries = 5, retryStatus = false;
	while (retryCounter <= maxRetries) {
		try {
			await page.goto(loginUrl, { timeout: 120000 });
			const usernameSelector = `[name='username']`;
			await page.waitForSelector(usernameSelector, { timeout: 20000 });
			await page.type(`[name='username']`, credentials.username, { delay: 10 });
		
			const passwordSelector = `[name='password']`;
			await page.waitForSelector(passwordSelector, { timeout: 20000 });
			await page.type(`[name='password']`, credentials.password, { delay: 10 });
			
			const loginButtonSelector = `[type='submit']`;
			await page.waitForSelector(loginButtonSelector, { timeout: 20000 });
			await page.click(loginButtonSelector);
			await page.evaluate(async () => {
				if (!document.querySelector(`input[name='username']`)) {
					//	Login page has not simply reloaded due to failure
					return true;
				}
				throw new Error(`Login page re-loaded. Trying again.`);
			})
			.then(() => retryStatus = true);

			if (retryStatus) break;
		} catch (error) {
			const waitTime = retryCounter*30000;
			console.log(`${chalk.gray(`Login attempt ${retryCounter} failed. ${(retryCounter <= maxRetries) ? `Waiting ${waitTime/1000}secs before retrying...` : ''}: ${error.message}`)}`);
			await timeout(retryCounter*30000);
			browser && await browser.close();
			browser = await launchBrowser();
			page = await browser.newPage();
			retryCounter++;
		}
	};
	return {
		browser,
		page,
		loggedIn: retryStatus
	};
};

export const scrollPageToBottom = async ( { page }) => {
	await page.evaluate(async () => {
		window.scrollTo(0, document.body.scrollHeight);
	});
};

export const runGetCruiseFromUrlsProcess = async ({
	productUrls
}: {
	productUrls: string
}) => {
	const browser = await launchBrowser();
	const page = await browser.newPage();
	page.setViewport({ width: 1200, height: 800 });
	//	Can replace limit querystring parameter with a higher value to get more results
	//const searchUrl = `https://cruise.travelat60.com/search/?type=all&layout=list&anchor=&sm_cruises=&sm_campaigns=&limit=10&max_results=0&leaf=0&month=&depart=&order=&focus=&group_ids=&search_id=&duration_from=&duration_to=&cost=&date_from=2025-04-01&date_to=2025-07-31&adults=2&children=0&children_age_1=&children_age_2=&children_age_3=&destination%5B%5D=Alaska&price_min=&price_max=50000&cruiseline%5B%5D=Holland%20America%20Line`;
	const urls = productUrls.split(',');

	for await (const url of urls) {
		const spinnerText = `Getting latest data for ${url}...`;
		const cruiseSpinner = createSpinner(spinnerText).start();
		await page.goto(url);
		const latestPricesCheckedSelector = `#cabin-filters`;
		await page.waitForSelector(latestPricesCheckedSelector, { timeout: 120000 });
		cruiseSpinner.success({ text: `${spinnerText}Done` });
	}
	await page.close();
	await browser.close();
};

export const runGetCruisesFromSearchProcess = async ({
	searchUrl,
}) => {
	const browser = await launchBrowser();
	const page = await browser.newPage();
	page.setViewport({ width: 1200, height: 800 });
	//	Can replace limit querystring parameter with a higher value to get more results
	//const searchUrl = `https://cruise.travelat60.com/search/?type=all&layout=list&anchor=&sm_cruises=&sm_campaigns=&limit=10&max_results=0&leaf=0&month=&depart=&order=&focus=&group_ids=&search_id=&duration_from=&duration_to=&cost=&date_from=2025-04-01&date_to=2025-07-31&adults=2&children=0&children_age_1=&children_age_2=&children_age_3=&destination%5B%5D=Alaska&price_min=&price_max=50000&cruiseline%5B%5D=Holland%20America%20Line`;
	await page.goto(searchUrl);
	const nextPageSelector = `button.load-more`;
	
	await scrollPageToBottom({ page });
	await page.waitForSelector(nextPageSelector, { timeout: 10000 });

	let hasNextPage = await page.$(nextPageSelector) !== null, currentPageCount = 1;
	let searchItems = [];
	while (hasNextPage) {
		try {
			await page.click(nextPageSelector);
			await scrollPageToBottom({ page });
			await sleep(2000);
			hasNextPage = await page.$(nextPageSelector) !== null;
			searchItems = await page.evaluate(() => {
				const items = [];
				document.querySelectorAll('.search-results > .search-item').forEach(item => {
					const titleElement = item.querySelector('.item-info a.title');
					const buttonElement = item.querySelector('.gbuttons a');
					const priceElement = item.querySelector('.search-prices .price h2');
					const cruiseMetaElement = item.querySelectorAll('.search-item-list .item__desc');
					if (!priceElement.textContent.includes('$')) return;
					const title = titleElement ? titleElement.textContent.trim() : null;
					const link = buttonElement ? buttonElement['href'] : null;
					const cruiseMeta = {
						cruiseDate: cruiseMetaElement[0].textContent.trim(),
						cruiseDuration: cruiseMetaElement[1].textContent.trim(),
						cruiseShip: cruiseMetaElement[2].textContent.trim(),
					};
					items.push({ title, link, cruiseMeta });
				});
				return items;
			});
			currentPageCount++;
		} catch (error) {
			console.log('Error getting cruises:', error.message);
			hasNextPage = false;
		}
	}

	if (searchItems.length > 0) {
		console.log(`${chalk.green(`Found ${searchItems.length} cruises with valid pricing. Getting latest prices.`)}\n`);
		for await (const item of searchItems) {
			await getCruise(item, browser);
		}
	}
	console.log(`\n${chalk.green('Latest prices processed successfully. Shutting down...')}`);
	await page.close();
	await browser.close();
};

export const getCruise = async (cruise: any, browser) => {
	const cruisePage = await browser.newPage();
	cruisePage.setViewport({ width: 1200, height: 800 });
	await cruisePage.goto(cruise.link, { timeout: 10000 });
	const spinnerText = `Getting latest data for ${cruise.title} - ${cruise.cruiseMeta.cruiseShip} ${cruise.cruiseMeta.cruiseDate}...`;
	const cruiseSpinner = createSpinner(spinnerText).start();
	await cruisePage.click(`.book-now-button`);
	const nextStepButtonSelector = `button[type=submit].next-step`;
	await cruisePage.waitForSelector(nextStepButtonSelector, { timeout: 10000 });
	await cruisePage.click(nextStepButtonSelector);
	const latestPricesCheckedSelector = `#cabin-filters`;
	await cruisePage.waitForSelector(latestPricesCheckedSelector, { timeout: 120000 });
	await cruisePage.close();
	cruiseSpinner.success({ text: `${spinnerText}Done` });
	return cruise;
};
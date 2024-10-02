import puppeteer from "puppeteer";

export const launchBrowser = async (runHeadless = true) => {
	const browser = await puppeteer.launch({
		headless: runHeadless,
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
	});
	return browser;
}

export const timeout = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
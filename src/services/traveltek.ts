import { createSpinner } from "nanospinner";
import { launchBrowser, timeout } from "../helpers/browser.js";
import 'dotenv/config';
import { dateAdd, formatDate, formatTime } from "../helpers/lib.js";
import chalk from "chalk";

const loginUrl = process.env.TRAVELTEK_BOOKINGS_URL;
const bearerToken = process.env.BEARER_TOKEN;
const apiUrlBase = process.env.API_URL_BASE;
const processingStartTime = process.env.DAILY_PROCESSING_START_TIME || '09:00';
const processingEndTime = process.env.DAILY_PROCESSING_END_TIME || '21:30';
const defaultSleepTimeInMs = process.env.DEFAULT_SLEEP_TIME_IN_MS ? 
	Number(process.env.DEFAULT_SLEEP_TIME_IN_MS) : 
	300000;

export interface Credentials {
	username: string;
	password: string;
};

export const processBookings = async (browser, bookingsData, showLogging = true, currentPage?) => {
	let processBookingsSpinner = null,
		loggingMessage = `Getting data for ${bookingsData.length} bookings starting from the most recently added - ${bookingsData[0].referenceNumber}...`;

	if (showLogging) {
		processBookingsSpinner = createSpinner(loggingMessage).start();
	};

	const bookings = await Promise.all(await bookingsData.map(async booking => {
		// const { referenceNumber } = booking;
		// console.log(`Getting booking data for ${referenceNumber}...`);

		const bookingPage = currentPage ?? await browser.newPage();
		await bookingPage.goto(booking.url, { timeout: 120000 });

		const bookingDetailsSelector = `table.detailstable > tbody > tr.detailsrow`;
		await bookingPage.waitForSelector(bookingDetailsSelector);

		const bookingData = await bookingPage.evaluate(async () => {
			const detailsTable = Array.from(document.querySelectorAll('table.detailstable > tbody > tr.detailsrow td'));

			const conversion_reference = detailsTable[1].textContent.trim();
			let bookingPayload = [], detail = null;
			
			bookingPayload.push({ label: 'traveltek_url', value: document.location.href });

			if (detailsTable.length > 0) {	
				for (let i=0; i < detailsTable.length; i++) {
					const isEven = i % 2 == 0;
					const child = detailsTable[i];
					if (isEven) {
						detail = {
							...detail,
							label: child.textContent.trim().toLowerCase().replace(/\s+/g, '_')
						};
						continue;
					};
			
					if (!detail.label.trim()) {
						detail = null;
						continue;
					};
					
					bookingPayload.push({
						...detail,
						value: child.textContent.trim()
					});
					detail = null;
				}
			}

			const elements = document.querySelector('#elementlist');
			const portfoliosElements = elements.querySelectorAll('.portfolioelement');
			const elementsData = [];
			portfoliosElements.forEach((portfoliosElement, index) => {
				const portfolio = portfoliosElement.querySelectorAll('.listtable tr td');
				const hiddenDetails = portfoliosElement.querySelectorAll('& > div table tr td');

				const element = [
					{ label: 'provider', value: portfolio[6].textContent.trim() },
					{ label: 'provider_reference', value: portfolio[7].textContent.trim() },
					{ label: 'type', value: portfolio[3].textContent.trim() },
					{ label: 'net', value: portfolio[9].textContent.trim() },
					{ label: 'gross', value: portfolio[10].textContent.trim(), },
					{ label: hiddenDetails[0].textContent.trim().toLowerCase().replace(/\s+/g, '_'), value: hiddenDetails[1].textContent.trim(), },
					{ label: hiddenDetails[2].textContent.trim().toLowerCase().replace(/\s+/g, '_'), value: hiddenDetails[3].textContent.trim(), },
				];
				elementsData.push(element.reduce((acc, { label, value }) => {
					acc[label] = value;
					return acc;
				}, {}));

				// console.log('Each element', { elementsData });
			});

			bookingPayload = {
				...bookingPayload.reduce((acc, { label, value }) => {
					acc[label] = value;
					return acc;
				}, {}),
				...{ elements: elementsData }
			};
			// console.log({ data: portfolioData });

			//	All travellers
			const bookingPassengerListSelector = `#financial-details + h3 + .listtable .listrow`;
			const bookingPassengerList = document.querySelectorAll(bookingPassengerListSelector);
			const passengers = [];
			bookingPassengerList.forEach((passenger, index) => {
				const passengerName = passenger.querySelector(`td:nth-child(2)`).textContent.trim();
				const passengerFare = passenger.querySelector(`td:nth-child(4)`).textContent.trim();
				const passengerPhone = passenger.querySelector(`td:nth-child(6)`).textContent.trim();
				const passengerEmail = passenger.querySelector(`td:nth-child(8)`).textContent.trim();

				passengers.push({
					name: passengerName,
					fare: passengerFare,
					phone: passengerPhone,
					email: passengerEmail,
				});
			});
			bookingPayload['passengers'] = passengers;

			const payload = [
				{
					conversion_reference,
					additional_data: bookingPayload
				}
			];
			// console.log(payload);
			return payload;//response;
		});
	
		//	Costings
		const costingsSelector = `[href*='costingbreakdown']`;
		await bookingPage.waitForSelector(costingsSelector);
		await bookingPage.click(costingsSelector);
		await bookingPage.waitForSelector(`[href*='bofinancial.pl?action=costing_add']`);
		const costingsData = await bookingPage.evaluate(() => {
			const costingsElement = document.querySelectorAll(`.listtable #rtotalrow td`);
			return {
				nett: costingsElement[5].textContent.trim(),
				gross: costingsElement[6].textContent.trim(),
				apportioned: costingsElement[7].textContent.trim(),
				unapportioned: costingsElement[8].textContent.trim(),
				extra_margin: costingsElement[9].textContent.trim(),
				commission: costingsElement[10].textContent.trim(),
				gst: costingsElement[11].textContent.trim(),
			};
		});
		bookingData[0].additional_data['total_costings'] = costingsData;
		// console.log({ costingsData });

		//	Primary Booking Passenger
		const passengerSelector = `[href*='customer_view']`;
		await bookingPage.waitForSelector(passengerSelector);
		await bookingPage.click(passengerSelector);
		await bookingPage.waitForSelector(`.boxstyle1`);

		const passengerData = await bookingPage.evaluate(() => {
			const passengerContactDetailsElement = document.querySelectorAll(`h3 + table td`);
			const passengerName = passengerContactDetailsElement[1].textContent.trim();
			const passengerEmail = passengerContactDetailsElement[41].textContent.trim();
			const passengerPhone = passengerContactDetailsElement[31].textContent.trim();
			const passengerDOB = passengerContactDetailsElement[9].textContent.trim();
			const passengerPostcode = passengerContactDetailsElement[29].textContent.trim();

			return {
				name: passengerName,
				email: passengerEmail,
				phone: passengerPhone,
				dob: passengerDOB,
				postcode: passengerPostcode,
			};
		});
		
		bookingData[0].additional_data['primary_passenger'] = passengerData;
		// console.log({ passengerData });

		const response = await fetch(apiUrlBase, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${bearerToken}`
			},
			body: JSON.stringify(bookingData)
		})
		.then((response) => response.json())
		.catch((err) => console.error('Error occurred saving to database.', {err}));

		// console.log({
		// 	// 'API Response': response,
		// 	bookingData,
		// });

		await bookingPage.close();
		return {
			...bookingData,
			additional_data: {
				...bookingData['additional_data'],
				primary_passenger: passengerData 
			}
		};
	}));

	processBookingsSpinner && processBookingsSpinner.success({ text: `${loggingMessage}Done` });
};

export const getBookings = async (browser, page) => {
	const nextPageSelector = `.pages > .selpage + .page a:last-of-type`;
	let hasNextPage = await page.$(nextPageSelector) !== null;
	let isFirstPage = await page.$eval('.pages > .selpage', el => el.textContent) === '1';

	while (hasNextPage || isFirstPage) {
		const currentPageBookingsData = await page.evaluate(() => {
			const rows = Array.from(document.querySelectorAll(`table.listtable > tbody > tr.listrow`));
			return rows.map(row => {
				const columns = row.querySelectorAll(`td[width='10%']`);
				const bookingReference = columns[0].textContent.trim();
				const bookingUrl = columns[1].querySelector(`a`).href;
				return {
					referenceNumber: bookingReference,
					url: bookingUrl.replace('&shownote=1', '')
				};
			});
		});

		await processBookings(browser, currentPageBookingsData);

		hasNextPage = await page.$(nextPageSelector) !== null;
		isFirstPage = false;
		if (hasNextPage) {
			await Promise.all([
				page.waitForNavigation({ waitUntil: 'networkidle0' }),
				page.click(nextPageSelector)
			]);
			console.log('Navigating to next page...');
		}
	}
};

const doLogin = async (credentials: Credentials, page) => {
	page.goto(loginUrl, { timeout: 120000 });

	// Type into search box
	const usernameSelector = `[name='username']`;
	await page.waitForSelector(usernameSelector);
	await page.type(`[name='username']`, credentials.username, { delay: 10 });

	const passwordSelector = `[name='password']`;
	await page.waitForSelector(passwordSelector);
	await page.type(`[name='password']`, credentials.password, { delay: 10 });
	
	const loginButtonSelector = `[type='submit']`;
	await page.waitForSelector(loginButtonSelector);
	await page.click(loginButtonSelector);
};

export const doTodaysBookings = async (credentials, browser?, startDate?, endDate?) => {
	const reportStartDate = startDate ? new Date(startDate) : new Date();
	const reportEndDate = endDate ? new Date(endDate) : new Date();

	const reportStartDay = reportStartDate.getDate();
	const reportStartMonth = reportStartDate.getMonth()+1;
	const reportStartYear = reportStartDate.getFullYear();

	const reportEndDay = reportEndDate.getDate();
	const reportEndMonth = reportEndDate.getMonth()+1;
	const reportEndYear = reportEndDate.getFullYear();

	// Launch the browser and open a new blank page
	browser = browser ?? await launchBrowser();
	const page = await browser.newPage();

	try {
		await doLogin(credentials, page);

		await page.goto(`https://isell.traveltek.net/SAS/backoffice/boportfolios.pl?
			reference=&firstname=&lastname=&tradingnameid=&datetype=created&
			startdate-day=${reportStartDay}&startdate-month=${reportStartMonth}&startdate-year=${reportStartYear}&
			enddate-day=${reportEndDay}&enddate-month=${reportEndMonth}&enddate-year=${reportEndYear}&
			postcode=&telephone=&createdby=&branch=&bookinguser=&holidaymakerid=&
			externalref=&elementtype=&suppliername=&supplierref=&status=&promocode=&
			affiliate=&bookingteamid=&bookingbranchid=&customstatusid=&sourcecodeid=&
			cruisevoyagecode=&from=&action=&submit=Search+Portfolios`, { timeout: 120000 });

		const listBookingsSelector = `table.listtable > tbody > tr.listrow`;
		await page.waitForSelector(listBookingsSelector, { timeout: 5000 })
			.then(async () => await getBookings(browser, page))
			.catch((error) => console.error(`No bookings exist for ${formatDate(reportStartDate)}`));	
	} catch (error) {
		console.error('Error: ', error);
	} finally {
		// await browser.close();
	}
};

export const doHistoricalBookings = async (credentials, historicalDataStartDate, historicalDataEndDate, browser?) => {
	const existingBookings = await fetch(`${apiUrlBase}/search?
		booked_on_from=${historicalDataStartDate}&
		booked_on_to=${historicalDataEndDate}&
		departure_date_from=${new Date().toISOString().split('T')[0]}&
		booking_status=Changed&booking_status=Query&booking_status=Open
		`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${bearerToken}`
		},
	})
	.then((response) => response.json())
	.then((response) => response.map(({ conversion_reference, traveltek_url }) => {
		return {
			referenceNumber: conversion_reference,
			url: traveltek_url
		}
	}));	

	if (existingBookings.length === 0) {
		console.log(`\nNo historical tasks to do. Exiting...`);
		process.exit();
	}

	browser = browser ?? await launchBrowser();
	const page = await browser.newPage();
	await doLogin(credentials, page);

	const startTime = new Date();
	console.log(`\nChecking and updating historical data from ${historicalDataStartDate} and it looks like there are ${existingBookings.length} records to get.\nThis takes a while so let's mark the start time as ${startTime.toLocaleTimeString()}.`);
	console.log(`\nSyncing ${existingBookings.length} historical bookings...`);
	let processBookingsSpinner = null;

	try {
		for (let i = 0; i < existingBookings.length; i+=10) {
			const arrayOfPromises = [];
			if (i < existingBookings.length) arrayOfPromises.push(processBookings(browser, [existingBookings[i]], false));
			if (i+1 < existingBookings.length) arrayOfPromises.push(processBookings(browser, [existingBookings[i+1]], false));
			if (i+2 < existingBookings.length) arrayOfPromises.push(processBookings(browser, [existingBookings[i+2]], false));
			if (i+3 < existingBookings.length) arrayOfPromises.push(processBookings(browser, [existingBookings[i+3]], false));
			if (i+4 < existingBookings.length) arrayOfPromises.push(processBookings(browser, [existingBookings[i+4]], false));
			if (i+5 < existingBookings.length) arrayOfPromises.push(processBookings(browser, [existingBookings[i+5]], false));
			if (i+6 < existingBookings.length) arrayOfPromises.push(processBookings(browser, [existingBookings[i+6]], false));
			if (i+7 < existingBookings.length) arrayOfPromises.push(processBookings(browser, [existingBookings[i+7]], false));
			if (i+8 < existingBookings.length) arrayOfPromises.push(processBookings(browser, [existingBookings[i+8]], false));
			if (i+9 < existingBookings.length) arrayOfPromises.push(processBookings(browser, [existingBookings[i+9]], false));

			const loggingMessage = `Syncing records ${i+1} - ${i+arrayOfPromises.length} of ${existingBookings.length} historical bookings starting at ${existingBookings[i]?.referenceNumber}...`;
			processBookingsSpinner = createSpinner(loggingMessage).start();

			await Promise.all(arrayOfPromises);
			processBookingsSpinner && processBookingsSpinner.success({ text: `${loggingMessage}Done` });
		};
	} catch (error) {
		processBookingsSpinner && processBookingsSpinner.error({ text: `Error: ${error.message}` });
	} finally {
		const endTime = new Date();
		console.log(`\nFinished checking and updating historical data. This took about ${parseInt(((endTime.getTime() - startTime.getTime())/1000/60).toString())} minutes.`);
		await browser.close();
	}
};

export const runDailyBookingProcessing = async (credentials,
	historicalProcessHasExecuted = false
) => {
	const daysAgoToProcessDaily = (0-Number(process.env.DAYS_AGO_TO_PROCESS_IN_DAILY_PROCESS)) || 0;

	let dailyProcessingIsSleeping = undefined;

	while (1 == 1) {
		const canStart = new Date() >= new Date(`${formatDate()} ${processingStartTime}`),
			hasEnded = new Date() >= new Date(`${formatDate()} ${processingEndTime}`);

		if (canStart && !hasEnded) {
			dailyProcessingIsSleeping = false;
			const browser = await launchBrowser();
			try {
				await doTodaysBookings(credentials, browser);

				//	Wait for a few seconds before running again because Traveltek API is slow
				await timeout(5000);

				//	update bookings made in the last 5 days
				await runHistoricalBookingProcessing(
					credentials, 
					formatDate(dateAdd(new Date(), daysAgoToProcessDaily, 'days')), 
					formatDate()
				);

				console.log(`Sleeping for a few minutes. Running again at ${formatTime(dateAdd(new Date(), (defaultSleepTimeInMs/1000/60), 'minutes'))}.\n`);
			} catch (e) {
				console.error('Exception occurred in daily bookings processing.', { e });
			} finally {
				browser && await browser.close();
				await timeout(defaultSleepTimeInMs);
			}
		} else {
			//	Only run historical bookings tasks outside the processing hours of the daily routine
			if (!historicalProcessHasExecuted || dailyProcessingIsSleeping === undefined) {
				//	Check for historical bookings that need processing
				try {
					//	Only execute if the daily processing is hibernating and also 
					//		bypass this if the daily processing was skipped because it was executed outside 
					//		the processing hours
					dailyProcessingIsSleeping !== undefined && await runHistoricalBookingProcessing(credentials);
					//	Turn if off after running once
					historicalProcessHasExecuted = true;
					!dailyProcessingIsSleeping && console.log(chalk.green(`\nHibernating bookings processing until ${processingStartTime}...`));
					dailyProcessingIsSleeping = true;
				} catch (err) {
					console.error('Error occurred processing historical bookings.', { err });
				}
			}
		}
	}
};

export const runHistoricalBookingProcessing = async (credentials, startDate?, endDate?) => {
	const historyStartDate = startDate ?? 
		(process.env.HISTORICAL_PROCESSING_DAY_0 ? 
			formatDate(new Date(process.env.HISTORICAL_PROCESSING_DAY_0)) : 
			'2019-06-01'
		);	// Defaults back to day 1 or Traveltek data
	const historyEndDate = endDate ?? new Date().toISOString().split('T')[0];

	const browser = await launchBrowser();
	await doHistoricalBookings(credentials, historyStartDate, historyEndDate, browser);
	browser && await browser.close();
	//	Let's allow some time to pass before trying again
	await timeout(10000);
};

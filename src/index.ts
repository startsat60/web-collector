import puppeteer from 'puppeteer';

const loginUrl = `https://travelat60.site.traveltek.net/extranet/login.pl`;
const travelTekLogin = '****';
const travelTekPassword = '****';
const bearerToken = '****';
const apiUrlBase = 'https://api.startsat60.com/v3/admin/holidays/conversions';

(async () => {

	const processBookings = async (browser, bookingsData, showLogging = true, currentPage?) => {
		showLogging && console.log(`Getting data for ${bookingsData.length} bookings starting at ${bookingsData[bookingsData.length - 1].referenceNumber}...`);

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
			.then((response) => response.json());
	
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
	};

	const getBookings = async (browser, page) => {
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

	const launch = async (startDate?, endDate?) => {

		const reportStartDate = startDate ? new Date(startDate) : new Date();
		const reportEndDate = endDate ? new Date(endDate) : new Date();

		const reportStartDay = reportStartDate.getDate();
		const reportStartMonth = reportStartDate.getMonth()+1;
		const reportStartYear = reportStartDate.getFullYear();

		const reportEndDay = reportEndDate.getDate();
		const reportEndMonth = reportEndDate.getMonth()+1;
		const reportEndYear = reportEndDate.getFullYear();

		// Launch the browser and open a new blank page
		const browser = await puppeteer.launch({ headless: true, timeout: 0, });
		const page = await browser.newPage();

		try {
			// Navigate the page to a URL
			await page.goto(loginUrl, { timeout: 120000 });
	
			// Set screen size
			await page.setViewport({width: 1024, height: 768});
	
			// Type into search box
			const usernameSelector = `[name='username']`;
			await page.waitForSelector(usernameSelector);
			await page.type(`[name='username']`, travelTekLogin, { delay: 10 });

			const passwordSelector = `[name='password']`;
			await page.waitForSelector(passwordSelector);
			await page.type(`[name='password']`, travelTekPassword, { delay: 10 });
			
			const loginButtonSelector = `[type='submit']`;
			await page.waitForSelector(loginButtonSelector);
			await page.click(loginButtonSelector);
	
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
				.catch((error) => console.error(`No bookings exist for ${reportStartDate}`));	
		} catch (error) {
			console.error('Error: ', error);
		} finally {
			await browser.close();
		}
	};
	
	//#region Do Today's bookings
	//	Get bookings date within a specific range
	const startDate = new Date().toISOString().split('T')[0]; //'2024-09-25';
	const numberOfDays:number = 1; // January + February + March + April + May
	let pauseBetweenIterations = 5000;
	let startTime = new Date();
	console.log(`\nStarting report data retrieval at ${startTime.toLocaleTimeString()}.`);

	for (let i = 0; i < numberOfDays; i++) {
		const reportStartDate = new Date(new Date(startDate).setDate(new Date(startDate).getDate() + i)).toISOString().split('T')[0];
		const reportEndDate = new Date(new Date(startDate).setDate(new Date(startDate).getDate() + i)).toISOString().split('T')[0];
		console.log(`\nProcessing report data for ${reportStartDate}...`);
		await launch(reportStartDate, reportEndDate);

		if (i === numberOfDays - 1) {
			console.log(`\nFinishing up...`);
			continue;
		};

		console.log(`\nPhew! Catching my breath for ${pauseBetweenIterations/1000} seconds...`);
		await new Promise(resolve => setTimeout(resolve, pauseBetweenIterations));
	}
	let endTime = new Date();
	console.log(`\nFinished retrieving report data from ${startDate} for ${numberOfDays} days. This took ${parseInt(((endTime.getTime() - startTime.getTime())/1000/60).toString()) < 2 ? 'no time at all.' : `about ${parseInt(((endTime.getTime() - startTime.getTime())/1000/60).toString())} minutes.`}`);
	//#endregion Do Today's bookings

	//#region Do Historical bookings
	const historicalDataStartDate = new Date(new Date().setFullYear(new Date().getFullYear() - 5)).toISOString().split('T')[0]; // 1 month ago
	const historicalDataEndDate = new Date().toISOString().split('T')[0]; //'2024-09-25';

	const existingBookings = await fetch(`${apiUrlBase}/search?
		booked_on_from=${historicalDataStartDate}&
		booked_on_to=${historicalDataEndDate}&
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

	//	Get all historical data and update it if necessary
	const browser = await puppeteer.launch({ headless: true, timeout: 0 });
	const page = await browser.newPage();
		// Navigate the page to a URL
	await page.goto(loginUrl, { timeout: 120000 });

	// Set screen size
	await page.setViewport({width: 1024, height: 768});

	// Type into search box
	const usernameSelector = `[name='username']`;
	await page.waitForSelector(usernameSelector);
	await page.type(`[name='username']`, travelTekLogin, { delay: 10 });

	const passwordSelector = `[name='password']`;
	await page.waitForSelector(passwordSelector);
	await page.type(`[name='password']`, travelTekPassword, { delay: 10 });

	const loginButtonSelector = `[type='submit']`;
	await page.waitForSelector(loginButtonSelector);
	await page.click(loginButtonSelector);
	startTime = new Date();
	console.log(`\nChecking and updating historical data from ${historicalDataStartDate} and it looks like there are ${existingBookings.length} records to get.\nThis takes a while so let's mark the start time as ${startTime.toLocaleTimeString()}.`);
	console.log(`\nSyncing ${existingBookings.length} historical bookings...`);

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

			console.log(`Syncing records ${i+1} - ${i+arrayOfPromises.length} of ${existingBookings.length} historical bookings starting at ${existingBookings[i]?.referenceNumber}...`);

			await Promise.all(arrayOfPromises);
			//	Let's process this faster
			// await new Promise(resolve => setTimeout(resolve, 3000));
		};
	} catch (error) {
		console.error('Error: ', error);
	} finally {
		endTime = new Date();
		console.log(`\nFinished checking and updating historical data. This took about ${parseInt(((endTime.getTime() - startTime.getTime())/1000/60).toString())} minutes.`);
		await browser.close();
	}
	//#endregion Do Historical bookings
})();
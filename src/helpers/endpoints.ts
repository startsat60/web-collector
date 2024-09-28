import { authApi } from "./api.js";

export const updateBookingConversion = ({
	payload,
}: any) => 
	authApi.post(`v2/holidays/conversions`, payload);

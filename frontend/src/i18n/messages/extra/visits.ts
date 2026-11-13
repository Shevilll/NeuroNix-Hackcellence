/**
 * Travel time between visits and reordering a day by drag and drop, in English and Hindi.
 * The "s." keys are backend messages: their English must match the backend's text exactly.
 */
export const en: Record<string, string> = {
  "pkg.legTravel": "About {time} to get there · {km} km",
  "pkg.legTimes": "{leave}–{arrive} IST",
  "pkg.legTight": "The next visit starts at {time} IST, before you can get there",
  "pkg.leaveHotel": "Leave {hotel}",
  "pkg.backToHotel": "Back to {hotel}",
  "pkg.hotelTight": "You reach the hotel at {time} IST, so you may reach this visit a little late",
  "pkg.noTravelTime": "Some visits here have no time to travel between them.",
  "pkg.fixTimings": "Fix the timings",
  "pkg.fixTimingsOn": "Fix the timings on {date}",
  "pkg.moveItem": "Move {name}. Drag it, or press the up and down arrow keys",
  "pkg.timesIst": "All times are India time (IST).",
  "s.reorderAll": "Send every visit of that day once, in the new order.",
  "s.reorderFit": "{name} does not fit in that order: it would end after it closes.",
  "s.reorderFull": "The visits on {date} do not all fit with time to travel between them. Use Fix the timings, then drag again.",
  "s.spaceFail": "The visits on {date} do not fit with time to travel between them. Remove one and try again.",
  "s.visitDropped": "{name} was taken off {date}: it did not fit with time to travel between visits.",
};

export const hi: Record<string, string> = {
  "pkg.legTravel": "वहाँ पहुँचने में लगभग {time} · {km} किमी",
  "pkg.legTimes": "भारत के समय {leave}–{arrive} IST",
  "pkg.legTight": "अगली जगह {time} IST पर शुरू होती है, आपके पहुँचने से पहले",
  "pkg.leaveHotel": "{hotel} से निकलें",
  "pkg.backToHotel": "{hotel} वापस",
  "pkg.hotelTight": "आप होटल {time} IST पर पहुँचते हैं, इसलिए यहाँ थोड़ी देर से पहुँच सकते हैं",
  "pkg.noTravelTime": "यहाँ कुछ जगहों के बीच आने-जाने का समय नहीं है।",
  "pkg.fixTimings": "समय ठीक करें",
  "pkg.fixTimingsOn": "{date} का समय ठीक करें",
  "pkg.moveItem": "{name} को खिसकाएं। खींचें, या ऊपर और नीचे के तीर बटन दबाएं",
  "s.reorderAll": "उस दिन की हर जगह एक बार, नए क्रम में भेजें।",
  "pkg.timesIst": "सभी समय भारत के समय (IST) में हैं।",
  "s.reorderFit": "{name} इस क्रम में नहीं आती: यह बंद होने के बाद खत्म होगी।",
  "s.reorderFull": "{date} की सभी जगहें बीच में आने-जाने के समय के साथ नहीं आतीं। पहले समय ठीक करें, फिर खींचें।",
  "s.spaceFail": "{date} की जगहें बीच में आने-जाने के समय के साथ नहीं आतीं। एक हटाएं और फिर से कोशिश करें।",
  "s.visitDropped": "{name} को {date} से हटाया गया: जगहों के बीच आने-जाने के समय के साथ यह नहीं आती थी।",
};

export interface DepartureCity {
  airport: string;
  city: string;
}

export interface Country {
  code: string;
  name: string;
}

export interface TripOptions {
  departure_cities: DepartureCity[];
  countries: Country[];
  rules: {
    min_nights: number;
    max_nights: number;
    min_nights_per_city: number;
    max_travelers: number;
    data_window: { first_night: string; last_departure: string };
  };
}

/** The 7 request fields, as the backend receives them. */
export interface TripRequest {
  origin: string;
  country: string;
  start_date: string;
  nights: number;
  adults: number;
  children_ages: number[];
  budget: number;
}

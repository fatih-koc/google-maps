const headers = new Headers();
headers.append(`X-CSCAPI-KEY`, `MUt4OWZ3YUxCNVA4dTJmeVl1dU9waUtJbU5ObjFpTnphNnh3cm9xVQ==`);

const requestOptions = {
   method: 'GET',
   headers: headers,
   redirect: 'follow'
};




export const allCountries = async () => {
    let response = await fetch(`https://api.countrystatecity.in/v1/countries`, requestOptions)
    let data = await response.json();
    return data;
}

export const statesByCountry = async (country) => {
    let response = await fetch(`https://api.countrystatecity.in/v1/countries/${country}/states`, requestOptions)
    let data = await response.json();
    return data;
}

export const citiesByCountry = async (country) => {
    let response = await fetch(`https://api.countrystatecity.in/v1/countries/${country}/cities`, requestOptions)
    let data = await response.json();
    return data;
}


export const citiesByCountryState = async (country, state) => {
    // console.log(`https://api.countrystatecity.in/v1/countries/${country}/states/${state}/cities`);
    let response = await fetch(`https://api.countrystatecity.in/v1/countries/${country}/states/${state}/cities`, requestOptions)
    let data = await response.json();
    return data;
}
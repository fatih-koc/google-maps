import clm from 'country-locale-map';

export const countrylocalemap = async (iso2) => {
    return await clm.getCountryByAlpha2(iso2);
}



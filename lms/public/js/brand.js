// Whose brand the pages show (Settings → Branding → Brand; shared/brand.js): ATLAS, or the school
// "powered by ATLAS". Holds the branding the server sent (set by applyBranding in shell.js), so any
// page or menu can name the brand without being handed it: brand() is "ATLAS" or the school's short
// name, brandProduct('Learn') is "ATLAS Learn" or "<short> Learn", brandHome() "ATLAS home" or
// "<short> home". Sentences about what the software itself does may keep saying ATLAS.
import { brandName, productName, branded, brandedProducts, isSchoolBrand } from '/shared/brand.js';

let current = {};
export const setBrand = (b) => {
  current = b || {};
};
export const currentBrand = () => current;
export const schoolBrand = () => isSchoolBrand(current);
export const brand = () => brandName(current);
export const brandProduct = (word) => productName(current, word);
export const brandHome = () => `${brandName(current)} home`;
// "ATLAS Learn · Admin" → "<short> Learn · Admin" (names written with ATLAS in front).
export const brandText = (name) => branded(current, name);
// "… in ATLAS Finance …" → "… in <short> Finance …" (product names inside a sentence).
export const brandProducts = (text) => brandedProducts(current, text);

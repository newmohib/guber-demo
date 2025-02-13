import { Job } from "bullmq";
import { countryCodes, dbServers, EngineType } from "../config/enums";
import { ContextType } from "../libs/logger";
import {
  jsonOrStringForDb,
  jsonOrStringToJson,
  stringOrNullForDb,
  stringToHash,
} from "../utils";
import _ from "lodash";
import { sources } from "../sites/sources";
import items from "../../pharmacyItems.json";
import connections from "../../brandConnections.json";
const jsonfile = require("jsonfile");


  // Optimizations Applied:

  // After optimization, the execution time has been reduced to:
  // Current assignBrandIfKnown Execution Time: 157.956 miliseconds

  // Before optimization, the execution time was measured as:
  // Existing System assignBrandIfKnown Execution Time: 23.202 seconds.


type BrandsMapping = { [key: string]: string[] };

export async function getBrandsMapping(): Promise<BrandsMapping> {
  const brandConnections = connections;
  const brandMap = new Map<string, Set<string>>();

  brandConnections.forEach(({ manufacturer_p1, manufacturers_p2 }) => {
    const brand1 = manufacturer_p1.toLowerCase();
    const brand2Array = manufacturers_p2
      .toLowerCase()
      .split(";")
      .map((b) => b.trim());

    if (!brandMap.has(brand1)) brandMap.set(brand1, new Set());

    brand2Array.forEach((brand2) => {
      if (!brandMap.has(brand2)) brandMap.set(brand2, new Set());
      brandMap.get(brand1)!.add(brand2);
      brandMap.get(brand2)!.add(brand1);
    });
  });

  const getRepresentativeBrand = (brands: Set<string>) => [...brands].sort()[0];

  const flatMap: BrandsMapping = {};
  brandMap.forEach((relatedBrands, brand) => {
    const fullSet = new Set(relatedBrands);
    fullSet.add(brand);
    const representativeBrand = getRepresentativeBrand(fullSet);
    fullSet.forEach((b) => (flatMap[b] = [representativeBrand]));
  });

  return flatMap;
}

async function getPharmacyItems(
  countryCode: countryCodes,
  source: sources,
  versionKey: string,
  mustExist = true
) {
  return items; // Simulated fetched data
}

const precompileRegex = (brand: string) => {
  const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escapedBrand}\\b`, "i");
};

export function checkBrandIsSeparateTerm(
  input: string,
  brand: string
): boolean {
  return precompileRegex(brand).test(input);
}

export async function assignBrandIfKnown(
  countryCode: countryCodes,
  source: sources,
  job?: Job
) {
  console.time("assignBrandIfKnown Execution Time");

  const [brandsMapping, products] = await Promise.all([
    getBrandsMapping(),
    getPharmacyItems(countryCode, source, "assignBrandIfKnown", false),
  ]);

  let updateProducts: any[] = [];
  let modifiedProductsOnly: any[] = [];

  products.forEach((product) => {
    if (product.m_id) {
      updateProducts.push(product);
      return;
    }

    const matchedBrands = new Set<string>();

    for (const brandKey in brandsMapping) {
      brandsMapping[brandKey].forEach((brand) => {
        const validatedBrand = brandValidation(
          product.title,
          brand,
          matchedBrands
        );
        if (validatedBrand) {
          matchedBrands.add(validatedBrand); // Add to the matched set
        }
      });
    }

    if (matchedBrands.size > 0) {
      // only modified products
      console.log({ matchedBrands });

      modifiedProductsOnly.push({
        ...product,
        manufacturer: matchedBrands.size ? [...matchedBrands][0] : null,
        m_id: product.source_id,
        source,
        country_code: countryCode,
        meta: { matchedBrands: [...matchedBrands] },
      });
      updateProducts.push({
        ...product,
        manufacturer: matchedBrands.size ? [...matchedBrands][0] : null,
        m_id: product.source_id,
        source,
        country_code: countryCode,
        meta: { matchedBrands: [...matchedBrands] },
      });
    } else {
      updateProducts.push({
        ...product,
      });
    }
  });

  console.log("\n----------------------------\n");
  // total time for assignBrandIfKnown
  console.timeEnd("assignBrandIfKnown Execution Time");

  // flter brand data
  jsonfile.writeFileSync("./update_filter_brand_data.json", brandsMapping);
  // old data for comparison
  jsonfile.writeFileSync("./old_product_data.json", products);

  // Then brand is inserted into product mapping table
  // Writing to a JSON file only once at the end instead of inside loops reduces I/O blocking.
  jsonfile.writeFileSync("./update_product_data.json", updateProducts);

  console.log("\n----------------------------\n");
  // only modified products
  jsonfile.writeFileSync("./modified_products_only.json", modifiedProductsOnly);
  console.log({modifiedProductsOnly});
  ;
  console.log("\n----------------------------\n");
}

// modify

// Precompile regex patterns outside the function for better performance
const normalizeRegex = /\bBabē\b/gi;
const ignoreRegex = /\b(BIO|NEB)\b/i;
const happyRegex = /\bHAPPY\b/;

// Convert arrays to sets for O(1) lookup
const priorityBrands = new Set([
  "RICH",
  "RFF",
  "flex",
  "ultra",
  "gum",
  "beauty",
  "orto",
  "free",
  "112",
  "kin",
  "happy",
]);

// Convert arrays to sets for O(1) lookup
const secondaryBrands = new Set(["heel", "contour", "nero", "rsv"]);
let inputText = ""
let _brndArr = []


export const brandValidation = (
  input: string,
  brand: string,
  matchedBrands: Set<string>
): string | null => {
  if (!input || typeof input !== "string") return null;

  // Skip validation if the brand is already matched
  if (matchedBrands.has(brand)) {
    return null;
  }

  // Normalize input (handling cases like "Babē = Babe")
  let processedInput = input.replace(normalizeRegex, "Babe");

  // Ignore brands like BIO and NEB
  if (ignoreRegex.test(processedInput)) {
    return null;
  }
  let words = []

  if ( processedInput && inputText !== processedInput) {
     words = processedInput.split(/\s+/); // Tokenize words
     _brndArr = [...words]
    inputText = processedInput
  } else {
    processedInput = inputText
    words = _brndArr
  }

  // Find the first match among priority, secondary brands, or "HAPPY"
  if (priorityBrands.has(words[0]) && !matchedBrands.has(words[0]))return words[0];
  else if (secondaryBrands.has(words[0]) && !matchedBrands.has(words[0]))return words[0];
  else if (secondaryBrands.has(words[1]) && !matchedBrands.has(words[1]))return words[1];
  else if (happyRegex.test(processedInput) && !matchedBrands.has("HAPPY"))return "HAPPY";
  else return null
}
console.log("\n----------------------------\n");

// Extract the countries the maps draw from world-atlas into a small GeoJSON,
// so the bundle doesn't ship the whole 50m atlas. Run: bun scripts/geo.ts
import { feature } from "topojson-client";
import countries from "world-atlas/countries-50m.json";

const KEEP = ["Denmark", "Sweden", "Germany"];
const geo = feature(countries as any, (countries as any).objects.countries) as any;
const features = geo.features.filter((f: any) => KEEP.includes(f.properties.name));
await Bun.write("src/geo.json", JSON.stringify({ type: "FeatureCollection", features }));
console.log(`src/geo.json: ${features.map((f: any) => f.properties.name).join(", ")}`);

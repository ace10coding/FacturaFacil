import { DEMO_EMAIL } from "../lib/demo";
import { DEMO_PASSWORD, seedDemoData } from "../lib/demo-seed";

seedDemoData();
console.log(`Conta demo: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);

import { add } from "../src/math.js";

if (add(2, 3) !== 5) {
  throw new Error("add(2, 3) should equal 5");
}

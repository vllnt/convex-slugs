import { defineComponent } from "convex/server";

/** Component definition, named `slugs`. Mount it with `app.use(config)` in `convex/convex.config.ts`. */
const component = defineComponent("slugs");

// Nest official child components here, e.g.:
// import sharded from "@convex-dev/sharded-counter/convex.config";
// component.use(sharded);

export default component;

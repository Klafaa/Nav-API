import "./errors";
import "./resolvers";
import { builder } from "./builder";

export const schema = builder.toSchema();

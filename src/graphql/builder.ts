import SchemaBuilder from "@pothos/core";
import {
  DateTimeISOResolver,
  JSONResolver,
  NonEmptyStringResolver,
  NonNegativeIntResolver,
  PositiveIntResolver,
} from "graphql-scalars";
import type { GraphQLContext } from "./context";

export interface SchemaTypes {
  Context: GraphQLContext;
  Scalars: {
    DateTime: { Input: string; Output: string };
    JSON: { Input: unknown; Output: unknown };
    NonEmptyString: { Input: string; Output: string };
    PositiveInt: { Input: number; Output: number };
    NonNegativeInt: { Input: number; Output: number };
  };
}

export const builder = new SchemaBuilder<SchemaTypes>({});

builder.addScalarType("DateTime", DateTimeISOResolver);
builder.addScalarType("JSON", JSONResolver);
builder.addScalarType("NonEmptyString", NonEmptyStringResolver);
builder.addScalarType("PositiveInt", PositiveIntResolver);
builder.addScalarType("NonNegativeInt", NonNegativeIntResolver);

builder.queryType({
  description: "Read-only NAV operations and gateway introspection.",
});

builder.mutationType({
  description: "Submission of invoices, annulments and management of technical users.",
});

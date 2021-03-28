import React from "react";
import styled from "@emotion/styled/macro";
import { buildUrl } from "./public-url";

const Heading = styled.div`
  font-family: folkard, palitino, serif;
  font-size: 4em;
  margin-bottom: 42px;
  text-align: center;
  color: white;
`;

export const BrandLogoText = () => <Heading><img src={buildUrl('/images/logo.png')} alt={process.env.SITE_TITLE} /></Heading>;

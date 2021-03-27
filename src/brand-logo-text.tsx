import React from "react";
import styled from "@emotion/styled/macro";

const Heading = styled.div`
  font-family: folkard, palitino, serif;
  font-size: 4em;
  margin-bottom: 42px;
  text-align: center;
  color: white;
  width: 90%;
`;

export const BrandLogoText = () => <Heading><img src="/images/logo.png" alt="Wisps of Time - Maps" /></Heading>;

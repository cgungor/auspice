import { scaleLinear, scaleOrdinal } from "d3-scale";
import { min, max, range as d3Range } from "d3-array";
import { rgb } from "d3-color";
import { interpolateHcl } from "d3-interpolate";
import { genericDomain, colors, genotypeColors, reallySmallNumber, reallyBigNumber } from "./globals";
import { getAllValuesAndCountsOfTraitsFromTree } from "./treeCountingHelpers";
import { setLBI } from "./localBranchingIndex";
import { getExtraVals } from "./colorHelpers";
import { parseEncodedGenotype } from "./getGenotype";
import { setGenotype } from "./setGenotype";

const createLegendMatchBound = (colorScale) => {
  const lower_bound = {};
  const upper_bound = {};
  lower_bound[colorScale.domain()[0]] = reallySmallNumber;
  upper_bound[colorScale.domain()[0]] = colorScale.domain()[0];

  for (let i = 1; i < colorScale.domain().length; i++) {
    lower_bound[colorScale.domain()[i]] = colorScale.domain()[i - 1];
    upper_bound[colorScale.domain()[i]] = colorScale.domain()[i];
  }

  upper_bound[colorScale.domain()[colorScale.domain().length - 1]] = reallyBigNumber;

  return {
    lower_bound,
    upper_bound
  };
};

const genericScale = (cmin, cmax, vals = false) => {
  if (vals && vals.length <= 9) {
    return scaleLinear()
      .domain(vals)
      .range(colors[vals.length]);
  }
  /* if we have more than 9 values to display
  (and the scale is continuous at this point)
  create an evenly spaced 9-item domain (this is genericDomain) */
  const offset = +cmin;
  const range = cmax - cmin;
  return scaleLinear()
    .domain(genericDomain.map((d) => offset + d * range))
    .range(colors[9]);
};


const minMaxAttributeScale = (nodes, nodesToo, attr, options) => {
  if (Object.prototype.hasOwnProperty.call(options, "vmin") && Object.prototype.hasOwnProperty.call(options, "vmax")) {
    return genericScale(options.vmin, options.vmax);
  }
  const vals = nodes.map((n) => n.attr[attr]);
  if (nodesToo) {
    nodesToo.forEach((n) => vals.push(n.attr[attr]));
  }
  vals.filter((n) => n !== undefined)
    .filter((item, i, ar) => ar.indexOf(item) === i);
  return genericScale(min(vals), max(vals), vals);
};

const integerAttributeScale = (nodes, attr) => {
  const maxAttr = max(nodes.map((n) => n.attr[attr]));
  const minAttr = min(nodes.map((n) => n.attr[attr]));
  const nStates = maxAttr - minAttr;
  if (nStates < 11) {
    const domain = [];
    for (let i = minAttr; i <= maxAttr; i++) { domain.push(i); }
    return scaleLinear().domain(domain).range(colors[maxAttr - minAttr]);
  }
  return genericScale(minAttr, maxAttr);
};

/* this creates a (ramped) list of colours
   this is necessary as ordinal scales can't interpololate colours.
   it would be cool to use chroma, but i couldn't import it properly :(
   http://gka.github.io/chroma.js/
   range: [a,b], the colours to go between
*/
const createListOfColors = (n, range) => {
  const scale = scaleLinear().domain([0, n])
    .interpolate(interpolateHcl)
    .range(range);
  return d3Range(0, n).map(scale);
};

const discreteAttributeScale = (nodes, nodesToo, attr) => {
  const stateCount = getAllValuesAndCountsOfTraitsFromTree(nodes, attr)[attr];
  if (nodesToo) {
    const sc = getAllValuesAndCountsOfTraitsFromTree(nodesToo, attr)[attr];
    for (let state in sc) { // eslint-disable-line
      if (stateCount[state]) {
        stateCount[state] += sc[state];
      } else {
        stateCount[state] = sc[state];
      }
    }
  }
  const domain = Object.keys(stateCount);
  domain.sort((a, b) => stateCount[a] > stateCount[b] ? -1 : 1);

  // note: colors[n] has n colors
  const colorList = domain.length <= colors.length ?
    colors[domain.length].slice() :
    colors[colors.length - 1].slice();

  /* if NA / undefined / unknown, change the colours to grey */
  for (const key of ["unknown", "undefined", "unassigned", "NA", "NaN"]) {
    if (domain.indexOf(key) !== -1) {
      colorList[domain.indexOf(key)] = "#DDDDDD";
    }
  }
  return scaleOrdinal()
    .domain(domain)
    .range(colorList);
};


export const calcColorScale = (colorBy, controls, tree, treeToo, metadata) => {
  console.log("calcColorScale. TreeToo?", !!treeToo)
  let genotype;
  if (colorBy.slice(0, 3) === "gt-" && controls.geneLength) {
    genotype = parseEncodedGenotype(colorBy, controls.geneLength);
    if (genotype.length > 1) {
      console.warn("Cannot deal with multiple proteins yet - using first only.");
    }
    setGenotype(tree.nodes, genotype[0].prot || "nuc", genotype[0].positions); /* modifies nodes recursively */
  }

  /* step 1: calculate the required colour scale */
  const version = controls.colorScale === undefined ? 1 : controls.colorScale.version + 1;

  const geneLength = controls.geneLength;
  const colorOptions = metadata.colorOptions;
  const absoluteDateMaxNumeric = controls.absoluteDateMaxNumeric;

  const treeTooNodes = treeToo ? treeToo.nodes : undefined;

  let colorScale;
  let continuous = false;
  let error = false;

  if (!tree.nodes) {
    console.warn("calcColorScale called before tree is ready.");
    // make a dummy color scale before the tree is in place
    continuous = true;
    colorScale = genericScale(0, 1);
  } else if (colorBy.slice(0, 2) === "gt") {
    if (!geneLength) {
      continuous = true;
      colorScale = genericScale(0, 1);
    } else {
      const stateCount = {};
      tree.nodes.forEach((n) => {
        stateCount[n.currentGt] ? stateCount[n.currentGt]++ : stateCount[n.currentGt] = 1;
      });
      // console.log("statecounts:", stateCount);
      const domain = Object.keys(stateCount);
      domain.sort((a, b) => stateCount[a] > stateCount[b]);
      colorScale = scaleOrdinal().domain(domain).range(genotypeColors);
    }
  } else if (colorBy === "lbi") {
    try {
      setLBI(tree.nodes, absoluteDateMaxNumeric, colorOptions.lbi.tau, colorOptions.lbi.timeWindow);
      // colorScale = minMaxAttributeScale(tree.nodes, "lbi", colorOptions.lbi); /* colour ramp over all values */
      colorScale = minMaxAttributeScale(undefined, undefined, "lbi", {vmin: 0, vmax: 0.7}); /* ramp over [0, 0.7] like nextflu */
      continuous = true;
    } catch (e) {
      console.error("Setting LBI failed.", e);
      error = true;
    }
  } else if (colorOptions && colorOptions[colorBy]) {
    if (colorOptions[colorBy].color_map) {
      console.log("Sweet - we've got a color_map for ", colorBy)
      let domain = colorOptions[colorBy].color_map.map((d) => { return d[0]; });
      let range = colorOptions[colorBy].color_map.map((d) => { return d[1]; });
      const extraVals = getExtraVals(tree.nodes, treeTooNodes, colorBy, colorOptions[colorBy].color_map);
      if (extraVals.length) {
        // we must add these to the domain + provide a value in the range
        domain = domain.concat(extraVals);
        const extrasColorAB = [rgb(192, 192, 192), rgb(32, 32, 32)];
        range = range.concat(createListOfColors(extraVals.length, extrasColorAB));
      }
      continuous = false;
      colorScale = scaleOrdinal()
        .domain(domain)
        .range(range);
    } else if (colorOptions && colorOptions[colorBy].type === "discrete") {
      console.log("making a discrete color scale for ", colorBy)
      continuous = false;
      colorScale = discreteAttributeScale(tree.nodes, treeTooNodes, colorBy);
    } else if (colorOptions && colorOptions[colorBy].type === "integer") {
      console.log("making an integer color scale for ", colorBy)
      continuous = false;
      colorScale = integerAttributeScale(tree.nodes, colorBy);
    } else if (colorOptions && colorOptions[colorBy].type === "continuous") {
      console.log("making a continuous color scale for ", colorBy)
      continuous = true;
      colorScale = minMaxAttributeScale(tree.nodes, treeTooNodes, colorBy, colorOptions[colorBy]);
    }
  } else {
    error = true;
  }

  if (error) {
    console.error("no colorOptions for ", colorBy, " returning minMaxAttributeScale");
    continuous = true;
    colorScale = minMaxAttributeScale(tree.nodes, undefined, colorBy, colorOptions[colorBy]);
  }


  return {
    colorScale: {
      scale: colorScale,
      continuous: continuous,
      colorBy: colorBy, // this should be removed
      legendBoundsMap: createLegendMatchBound(colorScale),
      version,
      genotype
    },
    version
  };
};

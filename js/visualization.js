// ═══════════════════════════════════════════════════════════
// D3.js 방사형 트리 시각화
// ═══════════════════════════════════════════════════════════

import { CATEGORIES } from "./keyword-data.js";
import { getTotalVolume } from "./keyword-engine.js";

let svg, g, zoom;
const width = 900;
const height = 600;

/**
 * 키워드 맵 초기화
 */
export function initVisualization() {
  window.addEventListener("keywords-generated", (e) => {
    renderTree(e.detail.keywords, e.detail.mainKeyword);
  });

  // 줌 컨트롤
  document.getElementById("btn-zoom-in")?.addEventListener("click", () => {
    if (svg && zoom) svg.transition().duration(300).call(zoom.scaleBy, 1.3);
  });
  document.getElementById("btn-zoom-out")?.addEventListener("click", () => {
    if (svg && zoom) svg.transition().duration(300).call(zoom.scaleBy, 0.7);
  });
  document.getElementById("btn-zoom-reset")?.addEventListener("click", () => {
    if (svg && zoom) svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
  });
}

/**
 * 키워드 결과를 트리로 변환 및 렌더링
 */
function renderTree(keywords, mainKeyword) {
  const container = document.getElementById("keyword-map");
  if (!container) return;

  container.innerHTML = "";

  // 트리 데이터 구성
  const treeData = buildTreeData(keywords, mainKeyword);
  if (!treeData) return;

  const containerRect = container.getBoundingClientRect();
  const w = containerRect.width || width;
  const h = Math.max(500, containerRect.height || height);

  // SVG 생성
  svg = d3.select(container)
    .append("svg")
    .attr("width", w)
    .attr("height", h);

  g = svg.append("g")
    .attr("transform", `translate(${w / 2}, ${h / 2})`);

  // 줌 설정
  zoom = d3.zoom()
    .scaleExtent([0.3, 3])
    .on("zoom", (event) => {
      g.attr("transform", event.transform);
    });

  svg.call(zoom);
  svg.call(zoom.transform, d3.zoomIdentity.translate(w / 2, h / 2).scale(0.85));

  // 트리 레이아웃
  const root = d3.hierarchy(treeData);
  const treeLayout = d3.tree()
    .size([2 * Math.PI, Math.min(w, h) / 2 - 80])
    .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth);

  treeLayout(root);

  // 링크 (곡선)
  g.selectAll(".link")
    .data(root.links())
    .join("path")
    .attr("class", "link")
    .attr("d", d3.linkRadial()
      .angle((d) => d.x)
      .radius((d) => d.y)
    );

  // 노드
  const node = g.selectAll(".node")
    .data(root.descendants())
    .join("g")
    .attr("class", "node")
    .attr("transform", (d) => `rotate(${(d.x * 180) / Math.PI - 90}) translate(${d.y}, 0)`);

  // 노드 원
  node.append("circle")
    .attr("r", (d) => getNodeRadius(d.data))
    .attr("fill", (d) => getNodeColor(d.data))
    .attr("stroke", (d) => getNodeColor(d.data))
    .attr("fill-opacity", 0.2)
    .on("click", (event, d) => handleNodeClick(d));

  // 노드 텍스트
  node.append("text")
    .attr("dy", "0.31em")
    .attr("x", (d) => (d.x < Math.PI) === !d.children ? 8 : -8)
    .attr("text-anchor", (d) => (d.x < Math.PI) === !d.children ? "start" : "end")
    .attr("transform", (d) => d.x >= Math.PI ? "rotate(180)" : null)
    .text((d) => truncateText(d.data.name, 20))
    .attr("font-size", (d) => d.depth === 0 ? "13px" : "10px")
    .attr("font-weight", (d) => d.depth === 0 ? "bold" : "normal");

  // 범례 업데이트
  renderLegend();
}

/**
 * 키워드 배열 → 트리 구조
 */
function buildTreeData(keywords, mainKeyword) {
  if (!keywords || keywords.length === 0) return null;

  const mainKw = keywords.find((k) => k.level === 0) || keywords[0];
  const tree = {
    name: mainKw.keyword,
    type: "main",
    stats: mainKw.stats,
    category: mainKw.category,
    children: [],
  };

  // 부모→자식 매핑
  const childrenMap = new Map();
  for (const kw of keywords) {
    if (kw.level === 0) continue;
    const parent = kw.parent || mainKw.keyword;
    if (!childrenMap.has(parent)) childrenMap.set(parent, []);
    childrenMap.get(parent).push(kw);
  }

  // 1차 자식
  const level1 = childrenMap.get(mainKw.keyword) || [];
  for (const l1 of level1) {
    const childNode = {
      name: l1.keyword,
      type: l1.type,
      stats: l1.stats,
      category: l1.category,
      children: [],
    };

    // 2차, 3차 자식
    const level2 = childrenMap.get(l1.keyword) || [];
    for (const l2 of level2) {
      const l2Node = {
        name: l2.keyword,
        type: l2.type,
        stats: l2.stats,
        category: l2.category,
        children: [],
      };

      const level3 = childrenMap.get(l2.keyword) || [];
      for (const l3 of level3) {
        l2Node.children.push({
          name: l3.keyword,
          type: l3.type,
          stats: l3.stats,
          category: l3.category,
        });
      }

      childNode.children.push(l2Node);
    }

    tree.children.push(childNode);
  }

  return tree;
}

/**
 * 노드 크기 (검색량 비례)
 */
function getNodeRadius(data) {
  if (!data.stats) return 5;
  const vol = getTotalVolume(data.stats);
  if (vol >= 50000) return 14;
  if (vol >= 20000) return 11;
  if (vol >= 5000) return 8;
  if (vol >= 1000) return 6;
  return 4;
}

/**
 * 노드 색상 (카테고리별)
 */
function getNodeColor(data) {
  if (data.type === "main") return "#6c5ce7";
  if (data.type === "api") return "#00cec9";
  if (data.type === "intent") return "#f39c12";
  const cat = CATEGORIES[data.category];
  return cat ? cat.color : "#95a5a6";
}

/**
 * 노드 클릭 핸들러 (확장/축소)
 */
function handleNodeClick(d) {
  // 클릭 시 해당 키워드 정보 표시
  const info = d.data;
  const vol = info.stats ? getTotalVolume(info.stats) : "?";
  const comp = info.stats?.compIdx || "?";
  console.log(`[키워드] ${info.name} | 검색량: ${vol} | 경쟁도: ${comp}`);
}

/**
 * 텍스트 길이 제한
 */
function truncateText(text, maxLen) {
  if (!text) return "";
  return text.length > maxLen ? text.substring(0, maxLen) + "…" : text;
}

/**
 * 범례 렌더링
 */
function renderLegend() {
  const legend = document.getElementById("map-legend");
  if (!legend) return;

  const items = [
    { color: "#6c5ce7", label: "메인 키워드" },
    { color: "#00cec9", label: "API 연관 키워드" },
    { color: "#f39c12", label: "의도 기반 키워드" },
    { color: "#2ecc71", label: "템플릿 키워드" },
  ];

  legend.innerHTML = items
    .map(
      (i) => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${i.color}"></span>
        <span>${i.label}</span>
      </div>`
    )
    .join("");
}

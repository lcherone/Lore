import type { CodeEntity, CodeRelationship, RegressionRecord } from "./types.js";
import { DEMO_REPOSITORY_ID } from "./demo-data.js";

const entities: CodeEntity[] = [
  {
    id: "entity_mapper_file",
    repositoryId: DEMO_REPOSITORY_ID,
    type: "file",
    name: "AvalaraTransactionMapper.php",
    qualifiedName: "src/Tax/Avalara/AvalaraTransactionMapper.php",
    path: "src/Tax/Avalara/AvalaraTransactionMapper.php",
    language: "php",
    fingerprint: "file:src/Tax/Avalara/AvalaraTransactionMapper.php",
    metadata: { subsystem: "tax", integration: "Avalara" }
  },
  {
    id: "entity_map_addresses",
    repositoryId: DEMO_REPOSITORY_ID,
    type: "method",
    name: "mapAddresses",
    qualifiedName: "AvalaraTransactionMapper::mapAddresses",
    path: "src/Tax/Avalara/AvalaraTransactionMapper.php",
    startLine: 42,
    endLine: 78,
    language: "php",
    fingerprint: "method:AvalaraTransactionMapper::mapAddresses",
    metadata: { subsystem: "tax", integration: "Avalara" }
  },
  {
    id: "entity_address_code",
    repositoryId: DEMO_REPOSITORY_ID,
    type: "method",
    name: "fromRole",
    qualifiedName: "AddressCode::fromRole",
    path: "src/Tax/Avalara/AddressCode.php",
    startLine: 19,
    endLine: 31,
    language: "php",
    fingerprint: "method:AddressCode::fromRole",
    metadata: { subsystem: "tax", integration: "Avalara" }
  },
  {
    id: "entity_create_tax",
    repositoryId: DEMO_REPOSITORY_ID,
    type: "service",
    name: "CreateTaxTransaction",
    qualifiedName: "CreateTaxTransaction",
    path: "src/Tax/CreateTaxTransaction.php",
    language: "php",
    fingerprint: "class:CreateTaxTransaction",
    metadata: { subsystem: "tax" }
  },
  {
    id: "entity_refund_tax",
    repositoryId: DEMO_REPOSITORY_ID,
    type: "service",
    name: "RefundTaxTransaction",
    qualifiedName: "RefundTaxTransaction",
    path: "src/Tax/RefundTaxTransaction.php",
    language: "php",
    fingerprint: "class:RefundTaxTransaction",
    metadata: { subsystem: "tax" }
  },
  {
    id: "entity_mapper_test",
    repositoryId: DEMO_REPOSITORY_ID,
    type: "test",
    name: "AvalaraTransactionMapperTest",
    qualifiedName: "AvalaraTransactionMapperTest",
    path: "tests/Tax/AvalaraTransactionMapperTest.php",
    language: "php",
    fingerprint: "test:AvalaraTransactionMapperTest",
    metadata: { framework: "PHPUnit" }
  },
  {
    id: "entity_refund_test",
    repositoryId: DEMO_REPOSITORY_ID,
    type: "test",
    name: "RefundTaxTransactionTest",
    qualifiedName: "RefundTaxTransactionTest",
    path: "tests/Tax/RefundTaxTransactionTest.php",
    language: "php",
    fingerprint: "test:RefundTaxTransactionTest",
    metadata: { framework: "PHPUnit" }
  },
  {
    id: "entity_basket_search",
    repositoryId: DEMO_REPOSITORY_ID,
    type: "method",
    name: "applyActiveFilter",
    qualifiedName: "BasketSearch::applyActiveFilter",
    path: "src/Search/Basket/BasketSearch.php",
    language: "php",
    fingerprint: "method:BasketSearch::applyActiveFilter",
    metadata: { subsystem: "CP/POS" }
  },
  {
    id: "entity_basket_test",
    repositoryId: DEMO_REPOSITORY_ID,
    type: "test",
    name: "BasketSearchTest",
    qualifiedName: "BasketSearchTest",
    path: "tests/Search/BasketSearchTest.php",
    language: "php",
    fingerprint: "test:BasketSearchTest",
    metadata: { framework: "PHPUnit" }
  },
  {
    id: "entity_order_address",
    repositoryId: DEMO_REPOSITORY_ID,
    type: "method",
    name: "getDeliveryAddress",
    qualifiedName: "Order::getDeliveryAddress",
    path: "src/Order/Order.php",
    language: "php",
    fingerprint: "method:Order::getDeliveryAddress",
    metadata: { subsystem: "order" }
  },
  {
    id: "entity_bc_exporter",
    repositoryId: DEMO_REPOSITORY_ID,
    type: "service",
    name: "BusinessCentralOrderExporter",
    qualifiedName: "BusinessCentralOrderExporter",
    path: "src/BusinessCentral/OrderExporter.php",
    language: "php",
    fingerprint: "class:BusinessCentralOrderExporter",
    metadata: { integration: "Business Central" }
  }
];

const relationships: CodeRelationship[] = [
  ["rel_1", "entity_map_addresses", "entity_address_code", "calls", 0.99, "static_analysis"],
  ["rel_2", "entity_create_tax", "entity_map_addresses", "calls", 0.98, "static_analysis"],
  ["rel_3", "entity_refund_tax", "entity_map_addresses", "calls", 0.96, "static_analysis"],
  ["rel_4", "entity_mapper_test", "entity_map_addresses", "tests", 0.99, "static_analysis"],
  ["rel_5", "entity_refund_test", "entity_refund_tax", "tests", 0.99, "static_analysis"],
  ["rel_6", "entity_address_code", "entity_refund_test", "historically_changes_with", 0.87, "git_history"],
  ["rel_7", "entity_basket_test", "entity_basket_search", "tests", 0.99, "static_analysis"],
  ["rel_8", "entity_bc_exporter", "entity_order_address", "calls", 0.93, "static_analysis"]
].map(([id, sourceEntityId, targetEntityId, relationshipType, confidence, source]) => ({
  id: String(id),
  repositoryId: DEMO_REPOSITORY_ID,
  sourceEntityId: String(sourceEntityId),
  targetEntityId: String(targetEntityId),
  relationshipType: String(relationshipType),
  confidence: Number(confidence),
  source: source as CodeRelationship["source"],
  metadata: source === "git_history" ? { sampleCount: 8, coChangeCount: 7 } : {}
}));

const regressions: RegressionRecord[] = [
  {
    id: "regression_refund",
    repositoryId: DEMO_REPOSITORY_ID,
    title: "Address role mapping broke refund tax requests",
    description: "PR #782 changed address-role mapping and caused refund requests to reuse the ShipTo address code.",
    pullRequestId: "782",
    ticketId: "SS-5882",
    affectedEntities: ["AddressCode::fromRole", "RefundTaxTransaction"],
    evidenceIds: ["ev782"],
    severity: "warning",
    createdAt: "2025-11-12T15:36:00.000Z"
  }
];

export function createDemoCodeGraph(): {
  entities: CodeEntity[];
  relationships: CodeRelationship[];
  regressions: RegressionRecord[];
} {
  return structuredClone({ entities, relationships, regressions });
}


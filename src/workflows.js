const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.env.WORKFLOW_DATA_DIR
  ? path.resolve(process.env.WORKFLOW_DATA_DIR)
  : path.join(path.resolve(process.env.WALLET_DATA_DIR || process.env.DATA_DIR || path.join(__dirname, '..', 'data')), 'workflow-presets');

fs.mkdirSync(ROOT, { recursive: true });

function safeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 90);
}

function fileFor(id) {
  const clean = safeId(id);
  return clean ? path.join(ROOT, `${clean}.json`) : '';
}

function readFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function summary(item) {
  return {
    id: item.id,
    name: item.name,
    description: item.description || '',
    nodeCount: item.workflow?.nodes?.length || 0,
    edgeCount: item.workflow?.edges?.length || 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function list() {
  return fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => readFile(path.join(ROOT, entry.name)))
    .filter(Boolean)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .map(summary);
}

function get(id) {
  const file = fileFor(id);
  if (!file || !fs.existsSync(file)) return null;
  return readFile(file);
}

function validateWorkflow(workflow) {
  if (!workflow || workflow.format !== 'xiaokai-workflow' || !Array.isArray(workflow.nodes)) {
    const error = new Error('请上传从画布导出的工作流文件');
    error.statusCode = 400;
    throw error;
  }
  if (!workflow.nodes.length || workflow.nodes.length > 120) {
    const error = new Error('工作流节点数量必须为 1–120 个');
    error.statusCode = 400;
    throw error;
  }
  if (!Array.isArray(workflow.edges)) workflow.edges = [];
  return workflow;
}

function save({ name, description, workflow, authorId }) {
  validateWorkflow(workflow);
  const cleanName = String(name || workflow.name || '未命名工作流').trim().slice(0, 60) || '未命名工作流';
  const id = `wf-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const now = Date.now();
  const item = {
    id,
    name: cleanName,
    description: String(description || '').trim().slice(0, 240),
    authorId: String(authorId || ''),
    createdAt: now,
    updatedAt: now,
    workflow,
  };
  fs.writeFileSync(fileFor(id), JSON.stringify(item));
  return summary(item);
}

function remove(id) {
  const file = fileFor(id);
  if (!file || !fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

module.exports = { list, get, save, remove };

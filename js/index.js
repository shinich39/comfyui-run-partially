"use strict";

import JSON5 from "./utils/json5.min.js";
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
  getFlacMetadata,
  getLatentMetadata,
  getPngMetadata,
  getWebpMetadata,
} from '../../scripts/pnginfo.js';

const CLASS_NAME = "Breakkk";
const PROP_NAME = "broken_prompt";

const Settings = {
  "RemoveBreakAfterGeneration": true,
  "Debug": false,
}

function getBreakNodes(workflow) {
  return workflow.nodes.filter((n) => n.type === CLASS_NAME && n.mode !== 4);
}

function getNextNodes(workflow, breakNode) {
  const accSet = new WeakSet();
  const accNodes = [breakNode];
  const computedIds = [];
  
  while(accNodes.length !== computedIds.length) {
    for (const node of accNodes) {

      if (computedIds.indexOf(node.id) > -1) {
        continue;
      }

      computedIds.push(node.id);

      for (const output of (node.outputs || [])) {
        
        const links = workflow.links.filter((l) => (output.links || []).find((ll) => l[0] === ll));
        const outputNodeIds = links.map((l) => l[3]);
        const outputNodes = workflow.nodes.filter((n) => outputNodeIds.indexOf(n.id) > -1);

        for (const outputNode of outputNodes) {
          if (!accSet.has(outputNode)) {
            accSet.add(outputNode);
            accNodes.push(outputNode);
          }
        }
      }
    }
  }

  return accNodes.slice(1);
}

function getAllBrokenNodes(workflow) {
  const breakNodes = getBreakNodes(workflow);

  const nodes = [];

  for (const node of breakNodes) {
    nodes.push(...getNextNodes(workflow, node));
  }

  return [...new Set(nodes)];
}

function getBatchCount() {
  return app.extensionManager.queueSettings.batchCount;
}

/**
 * Refs. ComfyUI_frontend/scripts/app.ts
 * 
 * Loads workflow data from the specified file
 * @param {File} file
 */
async function handleFile(file) {
  let prompt, workflow;

  if (file.type === 'image/png') {
    const pngInfo = await getPngMetadata(file);
    if (pngInfo?.workflow) {
      workflow = JSON5.parse(pngInfo.workflow);
    }
    if (pngInfo?.prompt) {
      prompt = JSON5.parse(pngInfo.prompt);
    }
  } else if (file.type === 'image/webp') {
    const pngInfo = await getWebpMetadata(file);

    // Support loading workflows from that webp custom node.
    workflow = pngInfo?.workflow || pngInfo?.Workflow
    prompt = pngInfo?.prompt || pngInfo?.Prompt

  } else if (file.type === 'audio/flac' || file.type === 'audio/x-flac') {
    const pngInfo = await getFlacMetadata(file)

    workflow = pngInfo?.workflow || pngInfo?.Workflow
    prompt = pngInfo?.prompt || pngInfo?.Prompt

  } else if (file.type === 'video/webm') {
    const webmInfo = await getFromWebmFile(file)
    
    workflow = webmInfo?.workflow || webmInfo?.Workflow
    prompt = webmInfo?.prompt || webmInfo?.Prompt

  } else if (
    file.type === 'model/gltf-binary' ||
    file.name?.endsWith('.glb')
  ) {
    const gltfInfo = await getGltfBinaryMetadata(file)

    workflow = gltfInfo?.workflow || gltfInfo?.Workflow
    prompt = gltfInfo?.prompt || gltfInfo?.Prompt

  } else if (
    file.type === 'application/json' ||
    file.name?.endsWith('.json')
  ) {
    const reader = new FileReader()
    reader.onload = async () => {
      const readerResult = reader.result;
      const jsonContent = JSON5.parse(readerResult)

      workflow = jsonContent?.workflow || jsonContent?.Workflow
      prompt = jsonContent?.prompt || jsonContent?.Prompt
    }
    reader.readAsText(file)
  } else if (
    file.name?.endsWith('.latent') ||
    file.name?.endsWith('.safetensors')
  ) {
    const info = await getLatentMetadata(file)

    workflow = info?.workflow || info?.Workflow
    prompt = info?.prompt || info?.Prompt
  }

  if (Settings["Debug"]) {
    console.log("[comfyui-run-partially]\nhandleFile() Workflow", workflow);
    console.log("[comfyui-run-partially]\nhandleFile() Prompt", prompt);
  }

  if (workflow && prompt) {
    const batchCount = getBatchCount();

    for (let i = 0; i < batchCount; i++) {
      try {
        const p = {
          output: prompt,
          workflow,
        }
        
        // push: 0, unshift: -1
        const res = await api.queuePrompt(0, p);

        if (Settings["Debug"]) {
          console.log("[comfyui-run-partially]\n", res);
        }

      } catch (err) {
        console.error(err);
      }
    }

  }
}

app.registerExtension({
	name: "shinich39.RunPartially",
  settings: [
    {
      id: 'shinich39.RunPartially.Debug',
      category: ['RunPartially', 'Pray for modularism', 'Debug'],
      name: 'Debug',
      tooltip: 'Write prompts in the browser console for debug.',
      type: 'boolean',
      defaultValue: false,
      onChange: (value) => {
        Settings["Debug"] = value;
      }
    },
    {
      id: 'shinich39.RunPartially.RemoveBreakAfterGeneration',
      category: ['RunPartially', 'Pray for modularism', 'RemoveBreakAfterGeneration'],
      name: 'Remove Break After Generation',
      tooltip: 'Remove \"Break\" node in generated workflow after run.',
      type: 'boolean',
      defaultValue: true,
      onChange: (value) => {
        Settings["RemoveBreakAfterGeneration"] = value;
      }
    },
  ],
  setup() {
    // append event last of loading extensions
    setTimeout(() => {
      const origQueuePrompt = api.queuePrompt;
      api.queuePrompt = async function(...args) {
  
        const { output, workflow } = args[1];

        const breakNodes = getBreakNodes(workflow);

        // initialize
        if (!workflow[PROP_NAME]) {

          if (breakNodes.length === 0) {
            return await origQueuePrompt.apply(this, arguments);
          }

          workflow[PROP_NAME] = {};

          // init break values to 0
          for (const obj of Object.values(output)) {
            obj.break = 0;
          }

          // increase break values
          for (const breakNode of breakNodes) {
            const nextNodes = getNextNodes(workflow, breakNode);

            for (const nextNode of nextNodes) {
              const obj = output["" + nextNode.id];
              if (obj) {
                obj.break++;
              }
            }
          }

          // extract broken prompts
          for (const id of Object.keys(output)) {
            const obj = output[id];
            if (obj.break > 0) {
              workflow[PROP_NAME][id] = output[id];
              delete output[id];
            } else {
              delete obj.break;
            }
          }
        }

        // if break value is 0,
        // move to output from broken object
        for (const id of Object.keys(workflow[PROP_NAME])) {
          const obj = workflow[PROP_NAME][id];
          if (obj.break < 1) {
            delete obj.break;
            output[id] = obj;
            delete workflow[PROP_NAME][id];
          } else {
            // decrease break value for next generation
            obj.break--;
          }
        }

        // remove break nodes
        if (Settings["RemoveBreakAfterGeneration"]) {

          for (const breakNode of breakNodes) {

            let originNode;
            let originLink;
            let originLinkIndex;

            const targetNodes = [];
            const targetLinks = [];
            const targetLinkIndexes = [];

            for (let i = 0; i < workflow.links.length; i++) {
              const link = workflow.links[i];
              const originId = link[1];
              const targetId = link[3];
  
              if (originId == breakNode.id) {
                targetNodes.push(workflow.nodes.find((n) => n.id == targetId));
                targetLinks.push(link);
                targetLinkIndexes.push(i);
              } else if (targetId == breakNode.id) {
                originNode = workflow.nodes.find((n) => n.id == originId);
                originLink = link;
                originLinkIndex = i;
              }
            }

            const originNodeId = originNode.id;
            const outputSlot = originLink[2];
            const output = originNode.outputs[outputSlot];

            // remove output links
            output.links = output.links.filter((l) => l[0] !== originLink[0]);

            // connect output nodes with input node
            for (const targetLink of targetLinks) {
              targetLink[1] = originNodeId;
              targetLink[2] = outputSlot;

              // set link to originNode.inputs[0].links
              output.links.push(targetLink[0]);
            }

            // remove origin link
            workflow.links.splice(originLinkIndex, 1);
          }

          // remove break node
          workflow.nodes = workflow.nodes.filter((n) => n.type !== CLASS_NAME);
        }

        if (Settings["Debug"]) {
          console.log("[comfyui-run-partially] Output\n", output);
          console.log(`[comfyui-run-partially] Workflow.${PROP_NAME}\n`, workflow);
        }

        return await origQueuePrompt.apply(this, arguments);
      }
  
      console.log("[comfyui-run-partially] initialized");
    }, 1024 * 1);
  },
  nodeCreated(node) {
    if (node.comfyClass === CLASS_NAME) {
      node.serialize_widgets = false;
      node.isVirtualNode = true;

      // button

      const b = node.addWidget("button", "Drop broken images here to continue", null, () => {}, { serialize: false, });
      b.computeSize = () => [0, 26];
      b.callback = async () => {
        const p = await app.graphToPrompt();
        const brokenNodes = getNextNodes(p.workflow, node);

        if (Settings["Debug"]) {
          console.log("[comfyui-run-partially]\n", brokenNodes);
        }

        const nodes = app.graph.nodes.filter((n) => !!brokenNodes.find((nn) => n.id === nn.id));
        app.canvas.deselectAll();
        app.canvas.selectNodes(nodes);
      };

       // drag and drop event

       const hasFiles = (items) => !!Array.from(items).find((f) => f.kind === 'file');

       const filterFiles = (files) => Array.from(files).filter((e) => 
         e.type.startsWith("image/") && e.type !== "image/bmp");
 
       const isDraggingFiles = (e) => {
         if (!e?.dataTransfer?.items) return false;
         return hasFiles(e.dataTransfer.items);
       }
     
       node.onDragOver = isDraggingFiles;
 
       // const origOnDragDrop = node.onDragDrop;
       node.onDragDrop = async function(e) {
        try {
          const files = filterFiles(e.dataTransfer.files);

          if (Settings["Debug"]) {
            console.log("[comfyui-run-partially]\n", files);
          }
          
          for (const file of files) {
            await handleFile(file);
          }
  
        } catch(err) {
          console.error(err);
        }
        return true;
       }
    }
	},
});
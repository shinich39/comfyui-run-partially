"use strict";

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
  getFlacMetadata,
  getLatentMetadata,
  getPngMetadata,
  getWebpMetadata,
} from '../../scripts/pnginfo.js';

const CLASS_NAME = "Skippp";

const Settings = {
  "RemoveAfterGeneration": true,
  "Debug": false,
}

function getSkippedNodes(workflow) {
  const skippedNodes = [];
  const executedIds = [];

  for (const node of workflow.nodes) {

    if (node.type !== CLASS_NAME) {
      continue;
    }

    // bypassed
    if (node.mode === 4) {
      continue;
    }

    skippedNodes.push(node);
  }

  while(skippedNodes.length !== executedIds.length) {

    for (const node of skippedNodes) {

      if (executedIds.indexOf(node.id) > -1) {
        continue;
      }

      executedIds.push(node.id);

      for (const output of (node.outputs || [])) {
        
        const links = workflow.links.filter((l) => (output.links || []).find((ll) => l[0] === ll));
        const outputNodeIds = links.map((l) => l[3]);
        const outputNodes = workflow.nodes.filter((n) => outputNodeIds.indexOf(n.id) > -1);

        for (const outputNode of outputNodes) {
          skippedNodes.push(outputNode);
        }

      }

    }
  }

  return skippedNodes;
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
async function handleFile(file ) {
  // const removeExt = (f) => {
  //   if (!f) return f
  //   const p = f.lastIndexOf('.')
  //   if (p === -1) return f
  //   return f.substring(0, p)
  // }

  // const fileName = removeExt(file.name)

  let prompt, workflow;

  if (file.type === 'image/png') {
    const pngInfo = await getPngMetadata(file);
    if (pngInfo?.workflow) {
      workflow = JSON.parse(pngInfo.workflow);
    }
    if (pngInfo?.prompt) {
      prompt = JSON.parse(pngInfo.prompt);
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
      const jsonContent = JSON.parse(readerResult)

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
    console.log("[comfyui-run-partially]\nWorkflow", workflow);
    console.log("[comfyui-run-partially]\nPrompt", prompt);
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
      id: 'shinich39.RunPartially.RemoveAfterGeneration',
      category: ['RunPartially', 'Pray for modularism', 'RemoveAfterGeneration'],
      name: 'Remove After Generation',
      tooltip: 'Remove \"Skip\" node in generated workflow after run.',
      type: 'boolean',
      defaultValue: true,
      onChange: (value) => {
        Settings["RemoveAfterGeneration"] = value;
      }
    },
  ],
  setup() {
    // append event last of loading extensions
    setTimeout(() => {
      const origQueuePrompt = api.queuePrompt;
      api.queuePrompt = async function(...args) {
  
        const { output, workflow } = args[1];

        if (workflow.skipped_prompt) {
          Object.assign(output, workflow.skipped_prompt);
          return await origQueuePrompt.apply(this, arguments);
        }

        workflow.skipped_prompt = {};

        let skippedNodes = getSkippedNodes(workflow);

        for (const node of skippedNodes) {
          const id = "" + node.id;

          if (output[id]) {
            workflow.skipped_prompt[id] = output[id];

            delete output[id];
          }
        }

        if (Settings["Debug"]) {
          console.log("[comfyui-run-partially]\n", skippedNodes);
        }

        // remove skip node
        if (Settings["RemoveAfterGeneration"]) {

          const skipNodes = skippedNodes.filter((n) => n.type === CLASS_NAME);

          for (const skipNode of skipNodes) {

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
  
              if (originId == skipNode.id) {
                targetNodes.push(workflow.nodes.find((n) => n.id == targetId));
                targetLinks.push(link);
                targetLinkIndexes.push(i);
              } else if (targetId == skipNode.id) {
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

          // remove skipNode
          workflow.nodes = workflow.nodes.filter((n) => n.type !== CLASS_NAME);
          skippedNodes = skippedNodes.filter((n) => n.type !== CLASS_NAME);
        }

        if (Settings["Debug"]) {
          console.log("[comfyui-run-partially] Workflow\n", workflow);
          console.log("[comfyui-run-partially] Prompt\n", output);
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

      const b = node.addWidget("button", "Test", null, () => {}, { serialize: false, });
      b.computeSize = () => [0, 26];
      b.callback = async () => {
        const p = await app.graphToPrompt();
        const skippedNodes = getSkippedNodes(p.workflow);

        if (Settings["Debug"]) {
          console.log("[comfyui-run-partially]\n", skippedNodes);
        }

        const nodes = app.graph.nodes.filter((n) => !!skippedNodes.find((nn) => n.id === nn.id));
        app.canvas.deselectAll();
        app.canvas.selectNodes(nodes);
      };

       // drag and drop event

       const hasFiles = (items) => !!Array.from(items).find((f) => f.kind === 'file');

       const filterFiles = (files) => Array.from(files).filter((e) => 
         e.type.startsWith("image/") && e.type !== "image/bmp");
 
       const hasValidFiles = (files) => filterFiles(files).length > 0;
     
       const isDraggingFiles = (e) => {
         if (!e?.dataTransfer?.items) return false;
         return hasFiles(e.dataTransfer.items);
       }
     
       const isDraggingValidFiles = (e) => {
         if (!e?.dataTransfer?.files) return false;
         return hasValidFiles(e.dataTransfer.files);
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
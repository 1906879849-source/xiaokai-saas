/* Production capability cleanup, reusable image slots, and dedicated image operations. */
(()=>{
  const IMAGE_OPERATION_CONFIG={
    expand:{
      title:'扩图',
      label:'扩图结果',
      prompt:'基于上游原图进行画面扩展。完整保留原图主体、人物身份、商品外观、文字与核心构图，不裁切、不重绘原有主体；只在画布新增区域自然补全环境、光影、透视与纹理，使扩展区域与原图无缝衔接。请结合当前选择的目标比例输出完整画面。'
    },
    multi:{
      title:'多角度',
      label:'多角度结果',
      prompt:'以上游图片为唯一主体参考，生成同一人物或同一商品的新视角画面。严格保持身份、脸部、服装、商品结构、颜色、材质和关键细节一致，只改变观察角度与合理姿态；背景与光线保持连贯，禁止生成不同主体或擅自修改商品设计。可在此补充需要的角度，例如侧面、背面、俯视或三分之四视角。'
    },
    smart:{
      title:'智能改图',
      label:'智能改图结果',
      prompt:'根据后续补充要求编辑上游图片。未被明确要求修改的主体身份、商品结构、服装细节、构图、比例、背景与光影必须保持不变；只修改指定内容，边缘自然、材质真实、透视一致。请在这段文字后补充具体修改要求。'
    }
  };

  function operationPosition(source){
    const card=source?.querySelector('.card');
    return{x:source.offsetLeft+(card?.offsetWidth||300)+190,y:source.offsetTop};
  }

  function ensureOperationButton(node){
    if(!node?.isConnected||!node.querySelector('.uploaded-image'))return;
    const actions=node.querySelector(':scope > .node-actions');
    if(!actions||actions.querySelector('[data-tool="smart"]'))return;
    const button=document.createElement('button');
    button.dataset.tool='smart';button.textContent='智能改图';
    const download=actions.querySelector('[data-tool="download"]');
    actions.insertBefore(button,download||null);
    button.onclick=event=>{event.stopPropagation();createImageOperation(node,'smart')};
  }

  function createImageOperation(source,operation){
    const config=IMAGE_OPERATION_CONFIG[operation];
    if(!config)return null;
    const image=requireRealImage(source);if(!image)return null;
    const {x,y}=operationPosition(source);
    const target=createGenerationNode(x,y);if(!target)return null;
    target.dataset.imageOperation=operation;
    target.dataset.operationSourceId=source.id;
    target.dataset.promptText=config.prompt;
    target.dataset.promptHtml=config.prompt;
    const label=target.querySelector('.node-label');if(label)label.textContent='▧　'+config.label;
    const card=target.querySelector('.card');
    if(card&&!card.querySelector('.operation-node-badge')){
      const badge=document.createElement('span');badge.className='operation-node-badge';badge.textContent=config.title;card.appendChild(badge)
    }
    createStableWire(source,target);
    selectNode(target,false,true);
    loadPromptFromNode(target);
    promptBox.placeholder='可继续补充'+config.title+'要求，然后点击生成';
    run.classList.add('ready');
    refreshInputReferences();renderDockVariablesFor(target);wires();scheduleSave();
    note(config.title+'节点已创建，可补充要求后点击生成');
    return target
  }

  const priorHandleImageTool=handleImageTool;
  handleImageTool=function(tool,node){
    if(IMAGE_OPERATION_CONFIG[tool])return createImageOperation(node,tool);
    return priorHandleImageTool(tool,node)
  };

  function emptySlotMarkup(){
    return '<input class="blank-image-file" type="file" accept="image/*" hidden><button class="blank-image-upload" type="button"><span class="blank-image-icon">▧</span><b>选择图片</b><small>点击后从电脑中选择</small></button>'
  }

  function filledSlotMarkup(src,name){
    const safeName=String(name||'客户上传图片').replace(/[&<>"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));
    return '<input class="blank-image-file" type="file" accept="image/*" hidden><img class="uploaded-image" alt="'+safeName+'" src="'+src+'">'
  }

  function ensureImageActions(node){
    if(node.querySelector(':scope > .node-actions'))return;
    node.insertAdjacentHTML('afterbegin',imageActions)
  }

  function applyImageSlotState(node,state,{save=true}={}){
    const card=node.querySelector('.blank-image-card');if(!card)return;
    if(state?.src){
      ensureImageActions(node);
      card.innerHTML=filledSlotMarkup(state.src,state.name);
      node.dataset.imageSlotState='filled';
      node.dataset.imageSlotFileName=state.name||'客户上传图片';
    }else{
      node.querySelector(':scope > .node-actions')?.remove();
      card.innerHTML=emptySlotMarkup();
      node.dataset.imageSlotState='empty';
      delete node.dataset.imageSlotFileName;
    }
    bindNodeControls(node);bindBlankImageNode(node);syncNodeChrome(node);wires();updateCompareNodes();
    if(save)scheduleSave()
  }

  function receiveSlotFile(node,file){
    if(!file||!file.type.startsWith('image/'))return note('请选择图片文件');
    const before=node.querySelector('.uploaded-image')?{src:node.querySelector('.uploaded-image').src,name:node.dataset.imageSlotFileName||''}:null;
    const reader=new FileReader();
    reader.onload=()=>{
      const after={src:reader.result,name:file.name||'客户上传图片'};
      applyImageSlotState(node,after);
      try{addAssets([file])}catch{}
      commitHistory({undo:()=>applyImageSlotState(node,before),redo:()=>applyImageSlotState(node,after)});
      selectNode(node,false,true);note('图片已填入，原有节点位置和连线保持不变')
    };
    reader.onerror=()=>note('图片读取失败，请重新选择');
    reader.readAsDataURL(file)
  }

  function bindBlankImageNode(node){
    if(!node?.classList?.contains('blank-image-node'))return node;
    const card=node.querySelector('.blank-image-card');if(!card)return node;
    const input=card.querySelector('.blank-image-file');
    const button=card.querySelector('.blank-image-upload');
    if(button)button.onclick=event=>{event.preventDefault();event.stopPropagation();input?.click()};
    if(input)input.onchange=event=>{const file=event.target.files?.[0];event.target.value='';if(file)receiveSlotFile(node,file)};
    ensureOperationButton(node);
    return node
  }

  function createBlankImageNode(x=(canvas.clientWidth/2-panX)/zoom,y=(canvas.clientHeight/2-panY)/zoom){
    const node=document.createElement('article');
    node.className='node uploaded-image-node blank-image-node';
    node.id='image-slot-'+Date.now()+'-'+Math.random().toString(16).slice(2);
    node.style.left=x+'px';node.style.top=y+'px';
    node.dataset.imageSlot='1';node.dataset.imageSlotState='empty';
    node.innerHTML='<div class="node-label">▧　导入图片</div><div class="card blank-image-card">'+emptySlotMarkup()+'</div><button class="plus">+</button>';
    world.appendChild(node);nodes.push(node);bindNode(node);bindBlankImageNode(node);selectNode(node);
    commitHistory({undo:()=>{node.remove();wires()},redo:()=>{world.appendChild(node);bindNode(node);bindBlankImageNode(node);wires()}});
    scheduleSave();note('空白图片节点已添加，可直接连接并保存为预设工作流');return node
  }

  const rail=document.querySelector('.rail');
  if(rail&&!rail.querySelector('[data-blank-image-tool]')){
    const button=document.createElement('button');button.className='tool';button.type='button';button.title='空白图片节点';button.dataset.blankImageTool='1';
    button.innerHTML='<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 15l3-3 3 3 2-2 3 3M12 8h.01"/></svg>';
    const imageTool=[...rail.querySelectorAll('.tool')].find(item=>item.title==='图片');
    imageTool?.before(button);
    button.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();rail.querySelectorAll('.tool').forEach(item=>item.classList.remove('on'));button.classList.add('on');createBlankImageNode()},true)
  }

  const priorExecuteContextAction=executeContextAction;
  executeContextAction=function(action,x,y){
    if(action==='空白图片')return createBlankImageNode(x,y);
    return priorExecuteContextAction(action,x,y)
  };
  const priorStableDraggedMenuAction=stableDraggedMenuAction;
  stableDraggedMenuAction=function(action,source,x,y){
    if(action!=='空白图片')return priorStableDraggedMenuAction(action,source,x,y);
    const created=createBlankImageNode(x,y),wire=createStableWire(source,created);
    selectNode(created);refreshInputReferences();renderDockVariablesFor(created);wires();queueMiniMapRender();scheduleSave();
    note(wire?'已创建空白图片节点并自动连接':'已创建空白图片节点');return created
  };

  function normalizeAgentNode(node){
    if(!node?.classList?.contains('agent-node'))return;
    const output=node.querySelector('.agent-output select');
    if(output){[...output.options].forEach(option=>{if(option.textContent.trim()!=='输出文字')option.remove()});if(!output.options.length)output.add(new Option('输出文字','输出文字'));output.value='输出文字'}
    const file=node.querySelector('.agent-skill-file');if(file)file.accept='.md'
  }

  function bindRestoredFeatures(){
    document.querySelectorAll('.blank-image-node').forEach(bindBlankImageNode);
    document.querySelectorAll('.uploaded-image-node').forEach(ensureOperationButton);
    document.querySelectorAll('.agent-node').forEach(normalizeAgentNode)
  }

  const observer=new MutationObserver(bindRestoredFeatures);
  observer.observe(world,{childList:true,subtree:true});
  bindRestoredFeatures();

  const priorQueueNodeExecution=queueNodeExecution;
  queueNodeExecution=function(node,options={}){
    const missing=incomingNodes(node).filter(source=>source.classList.contains('blank-image-node')&&!source.querySelector('.uploaded-image'));
    if(missing.length){
      const name=missing[0].querySelector('.node-label')?.textContent.replace(/^.*　/,'').trim()||'导入图片';
      note('请先在“'+name+'”节点上传图片');selectNode(missing[0],false,true);return false
    }
    return priorQueueNodeExecution(node,options)
  };

  // Remove obsolete, non-functional video placeholders from older saved projects.
  document.querySelectorAll('.agent-skill-file,#skillFile').forEach(input=>input.accept='.md');
  document.querySelectorAll('.video-node,.node').forEach(node=>{
    if(!node.classList.contains('video-node')&&!node.querySelector('.video-art'))return;
    document.querySelectorAll(`.wire path[data-a="${node.id}"],.wire path[data-b="${node.id}"]`).forEach(path=>path.remove());
    node.remove();
  });
})();

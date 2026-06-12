import json, os

chat_dir = 'E:/programs/matrix/renderer/data/chat'
agents_file = 'E:/programs/matrix/renderer/data/agents.json'

with open(agents_file, 'rb') as f:
    agents = json.load(f)

print(f'--- Agents ({len(agents)}) ---')
for a in agents:
    print(f'  id={a["id"]:40s} name={a["name"]}')

print('\n--- Chat files ---')
for f in os.listdir(chat_dir):
    if f.endswith('.json'):
        path = os.path.join(chat_dir, f)
        with open(path, 'rb') as fh:
            data = json.load(fh)
        agent_id = f.replace('.json', '')
        # check if this agent exists in agents list
        found = [a for a in agents if a['id'] == agent_id]
        print(f'  {f:30s} msgs={len(data):3d}  agent_exists={len(found)>0}')
        if data:
            first = data[0]
            print(f'    first: role={first.get("role","?")} text={str(first.get("text","") or first.get("content",""))[:60]}')

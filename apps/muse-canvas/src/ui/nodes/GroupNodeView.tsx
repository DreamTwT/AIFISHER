import { memo } from 'react';
import type { GroupNode } from '../../model/types';
import { useEditorState } from '../hooks';

function GroupNodeViewInner({ node }: { node: GroupNode }) {
  const { project } = useEditorState();
  const members = project.doc.nodes.filter((n) => node.memberIds.includes(n.id) && n.kind !== 'group');
  return (
    <>
      <div style={{ flex: 1 }} />
      <div className="group-members-hint">
        {members.slice(0, 4).map((m) => m.title).join(' · ')}
        {members.length > 4 ? ` · +${members.length - 4}` : ''}
      </div>
    </>
  );
}

export const GroupNodeView = memo(GroupNodeViewInner);

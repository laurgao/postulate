import React from "react";
import {GetServerSideProps} from "next";
import {DatedObj, ProjectObj, UserObj} from "../../../utils/types";
import MainShell, {NodeWithShortcut} from "../../../components/project/MainShell";
import getProjectSSRFunction from "../../../utils/getProjectSSRFunction";
import NodeCard from "../../../components/project/NodeCard";
import useSWR from "swr";
import {fetcher} from "../../../utils/utils";

export default function ProjectEvergreens({pageProject, pageUser, thisUser}: { pageProject: DatedObj<ProjectObj>, pageUser: DatedObj<UserObj>, thisUser: DatedObj<UserObj> }) {
    const isOwner = thisUser && pageUser._id === thisUser._id;

    const {data} = useSWR<{nodes: DatedObj<NodeWithShortcut>[]}>(`/api/node?projectId=${pageProject._id}&type=evergreen&isOwner=${!!isOwner}`, fetcher);

    return (
        <MainShell thisUser={thisUser} pageProject={pageProject} pageUser={pageUser}>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
                {data && data.nodes.map(node => <NodeCard
                    pageUser={pageUser}
                    pageProject={pageProject}
                    pageNode={node}
                    thisUser={thisUser}
                    key={`project-evergreen-${node._id}`}
                />)}
            </div>
        </MainShell>
    );
}

export const getServerSideProps: GetServerSideProps = getProjectSSRFunction("evergreen");
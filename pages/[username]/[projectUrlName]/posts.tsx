import React from "react";
import {GetServerSideProps} from "next";
import {DatedObj, NodeObj, ProjectObj, UserObj} from "../../../utils/types";
import MainShell from "../../../components/project/MainShell";
import getProjectSSRProps from "../../../utils/getProjectSSRProps";
import useSWR from "swr";
import {fetcher} from "../../../utils/utils";
import Link from "next/link";
import {format} from "date-fns";
import slateWordCount from "../../../slate/slateWordCount";

export default function ProjectPage({pageProject, pageUser, thisUser}: { pageProject: DatedObj<ProjectObj>, pageUser: DatedObj<UserObj>, thisUser: DatedObj<UserObj> }) {
    const {data} = useSWR<{nodes: DatedObj<NodeObj>[]}>(`/api/node?projectId=${pageProject._id}&type=post&isOwner=true`, fetcher);

    return (
        <MainShell thisUser={thisUser} pageProject={pageProject} pageUser={pageUser}>
            {data && data.nodes.map(node => {
                const isPublished = !!node.body.publishedTitle;
                const hasChanges = isPublished && JSON.stringify(node.body.publishedBody) !== JSON.stringify(node.body.body);

                return (
                    <Link href={`/@${pageUser.username}/${pageProject.urlName}/${node._id}`}>
                        <a className="block mb-8">
                            <h3
                                className="font-manrope font-semibold"
                                key={node._id}
                            >{node.body.title || "Untitled post"}</h3>
                            <div className="flex items-center mt-2 text-gray-400 text-sm">
                                {!isPublished && (
                                    <div
                                        className="bg-gray-500 border border-gray-700 text-white rounded-md text-xs mr-3"
                                        style={{padding: "2px 4px"}}
                                    >
                                        <span>Unpublished draft</span>
                                    </div>
                                )}
                                <span className="mr-3">
                                    Last {isPublished ? "published" : "updated"} {format(new Date(isPublished ? node.body.lastPublishedDate : node.updatedAt), "MMM d, yyyy")}
                                </span>
                                <span className="mr-3">{Math.ceil(slateWordCount(node.body.body) / 200)} min read</span>
                                {hasChanges && (
                                    <div
                                        className="bg-gray-50 border border-gray-300 text-gray-500 mr-3 rounded-md text-xs"
                                        style={{padding: "2px 4px"}}
                                    >
                                        <span>Unpublished changes</span>
                                    </div>
                                )}
                            </div>
                        </a>
                    </Link>
                );
            })}
        </MainShell>
    );
}

export const getServerSideProps: GetServerSideProps = getProjectSSRProps;
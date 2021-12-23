import {NextApiRequest, NextApiResponse} from "next";
import {getSession} from "next-auth/client";
import {ProjectModel} from "../../../models/project";
import {DatedObj, PostObj, ProjectObj} from "../../../utils/types";
import {PostModel} from "../../../models/post";
import {format} from "date-fns";
import short from "short-uuid";
import {UserModel} from "../../../models/user";
import {ImageModel} from "../../../models/image";
import {deleteImages} from "../../../utils/deleteImages";
import {SnippetModel} from "../../../models/snippet";
import dbConnect from "../../../utils/dbConnect";
import {TagModel} from "../../../models/tag";
import mongoose from "mongoose";
import {serialize} from "remark-slate";
import {findImages, findLinks, getCursorStages, postGraphStages} from "../../../utils/utils";
import {LinkModel} from "../../../models/link";
import {AES} from "crypto-js";
import axios from "axios";
import ellipsize from "ellipsize";
import htmlDecode from "../../../utils/htmlDecode";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (["POST", "DELETE"].includes(req.method)) {
        const session = await getSession({ req });

        if (!session || !session.userId) {
            return res.status(403).json({message: "You must be logged in to make a post."});
        }

        switch (req.method) {
            case "POST":
                // ensure necessary post params are present
                if (!(req.body.projectIds && req.body.projectIds.length)) return res.status(406).json({message: "No project IDs found in request."});
                if (!req.body.tempId) return res.status(406).json({message: "No post urlName found in request."});
                if (!req.body.title) return res.status(406).json({message: "No post title found in request."});
                if (!req.body.body) return res.status(406).json({message: "No post body found in request."});
                if (!["public", "private", "unlisted", "draft"].includes(req.body.privacy)) return res.status(406).json({message: "Missing or invalid privacy setting"});

                const body = req.body.isSlate ? htmlDecode(htmlDecode(htmlDecode(serialize({
                    type: "div",
                    children: req.body.body,
                })))) : req.body.body;

                const projectIds = req.body.projectIds;

                try {
                    await dbConnect();

                    const thisProject = await ProjectModel.find({ _id: {$in: projectIds}});
                    if (!(thisProject && thisProject.length)) return res.status(500).json({message: "No projects exists for given IDs"});
                    if (thisProject.some(project => (project.userId.toString() !== session.userId) && !project.collaborators.map(d => d.toString()).includes(session.userId))) return res.status(403).json({message: "You do not have permission to add posts in this project."});

                    // create new tags
                    if (req.body.tags && req.body.tags.length) {
                        const existingTags = await TagModel.find({ key: { $in: req.body.tags }});
                        const newTags = req.body.tags.filter(d => !existingTags.some(x => x.key === d));
                        if (newTags.length) await TagModel.insertMany(newTags.map(d => ({key: d})));
                    }

                    // check links

                    let linksToAdd = findLinks(req.body.body);

                    if (req.body.postId) {
                        const thisPost = await PostModel.findOne({ _id: req.body.postId });
                        if (!thisPost) return res.status(500).json({message: "No post exists for given ID"});

                        thisPost.title = req.body.title;
                        thisPost.body = body;
                        if (req.body.isSlate) thisPost.slateBody = req.body.body;
                        thisPost.projectId = projectIds[0];
                        thisPost.projectIds = projectIds;
                        thisPost.privacy = req.body.privacy;
                        thisPost.tags = req.body.tags;

                        if (req.body.date) thisPost.createdAt = req.body.date;

                        await thisPost.save();

                        // update attachments
                        const attachedImages = await ImageModel.find({ attachedUrlName: thisPost.urlName });

                        if (attachedImages.length) {
                            const usedImages = findImages(req.body.body);
                            const unusedImages = attachedImages.filter(d => !usedImages.some(x => x.includes(d.key)));
                            await deleteImages(unusedImages);
                        }

                        // find existing links
                        const existingLinks = await LinkModel.find({nodeType: "post", nodeId: mongoose.Types.ObjectId(req.body.postId), targetType: "url"});
                        // delete links no longer linked in snippet
                        const linksToDelete = existingLinks.filter(d => !linksToAdd.includes(d.targetUrl)).map(d => d._id);
                        if (linksToDelete.length) await LinkModel.deleteMany({_id: {$in: linksToDelete}});
                        // update linksToAdd for new links
                        linksToAdd = linksToAdd.filter(d => !existingLinks.some(x => x.targetUrl === d));
                        if (linksToAdd.length) {
                            // @ts-ignore TS wants _id for some reason
                            await LinkModel.insertMany(linksToAdd.map(d => ({
                                nodeType: "post",
                                nodeId: req.body.postId,
                                targetType: "url",
                                targetUrl: d,
                            })));
                        }

                        // update linked snippets
                        const linkedSnippets = await SnippetModel.find({ linkedPosts: thisPost._id });
                        const unlinkedSnippetIds = linkedSnippets.map(d => d._id.toString()).filter(d => (req.body.selectedSnippetIds && req.body.selectedSnippetIds.length) ? !req.body.selectedSnippetIds.includes(d) : true);
                        const newLinkedSnippetIds = (req.body.selectedSnippetIds && req.body.selectedSnippetIds.length) ? req.body.selectedSnippetIds.filter(d => !linkedSnippets.map(d => d._id.toString()).includes(d)) : [];

                        if (newLinkedSnippetIds.length) {
                            await SnippetModel.updateMany({ _id: { $in: newLinkedSnippetIds } }, {
                                $push: { linkedPosts: thisPost._id }
                            });
                        }

                        if (unlinkedSnippetIds.length) {
                            await SnippetModel.updateMany({ _id: { $in: unlinkedSnippetIds } }, {
                                $pull: { linkedPosts: thisPost._id }
                            });
                        }

                        res.status(200).json({
                            message: "Post successfully updated.",
                            url: `/@${session.username}/p/${thisPost.urlName}`,
                        });

                        return;
                    } else {
                        const urlName: string =
                            format(new Date(), "yyyy-MM-dd") +
                            "-" + encodeURIComponent(req.body.title.split(" ").slice(0, 5).join("-")) +
                            "-" + short.generate();

                        // assume isSlate always true
                        let newPost: PostObj = {
                            urlName: urlName,
                            projectId: projectIds[0],
                            projectIds: projectIds,
                            userId: session.userId,
                            title: req.body.title,
                            body: body,
                            slateBody: req.body.body,
                            privacy: req.body.privacy,
                            tags: req.body.tags,
                        }

                        if (req.body.date) newPost["createdAt"] = req.body.date;

                        const newPostObj = await PostModel.create(newPost);

                        // update attachments
                        const attachedImages = await ImageModel.find({ attachedUrlName: req.body.tempId });

                        if (attachedImages.length) {
                            const bodyString = JSON.stringify(req.body.body);
                            const unusedImages = attachedImages.filter(d => !bodyString.includes(d.key));
                            await deleteImages(unusedImages);

                            const usedImageIds = attachedImages.filter(d => bodyString.includes(d.key)).map(d => d._id.toString());
                            await ImageModel.updateMany({_id: {$in: usedImageIds}}, {
                                attachedUrlName: urlName,
                            });
                        }

                        // create links
                        if (linksToAdd.length) {
                            // @ts-ignore TS wants _id for some reason
                            await LinkModel.insertMany(linksToAdd.map(d => ({
                                nodeType: "post",
                                nodeId: newPostObj._id,
                                targetType: "url",
                                targetUrl: d,
                            })));
                        }

                        // update linked snippets
                        if (req.body.selectedSnippetIds && req.body.selectedSnippetIds.length) {
                            await SnippetModel.updateMany({ _id: { $in: req.body.selectedSnippetIds } }, {
                                $push: { linkedPosts: newPostObj._id }
                            });
                        }

                        res.status(200).json({
                            message: "Post successfully created.",
                            url: `/@${session.username}/p/${urlName}`,
                        });

                        return;
                    }
                } catch (e) {
                    return res.status(500).json({message: e});
                }
            case "DELETE":
                if (!req.body.postId) return res.status(406).json({message: "No post ID found in request."});

                try {
                    await dbConnect();

                    await PostModel.deleteOne({ _id: req.body.postId });

                    // `req.body.tempId` is the same as `urlName` when sent from an existing post
                    const attachedImages = await ImageModel.find({attachedUrlName: req.body.tempId});
                    await deleteImages(attachedImages);

                    // delete links
                    await LinkModel.deleteMany({nodeId: req.body.postId});

                    // update linked snippets
                    await SnippetModel.updateMany({ linkedPosts: req.body.postId }, {
                        $pull: { linkedPosts: req.body.postId }
                    });

                    res.status(200).json({message: "Post successfully deleted."});

                    return;
                } catch (e) {
                    return res.status(500).json({message: e});
                }
        }
    }

    switch (req.method) {
        case "GET":
            if (
                !(req.query.projectId || req.query.userId || req.query.publicFeed) ||
                (Array.isArray(req.query.projectId) || Array.isArray(req.query.userId) || Array.isArray(req.query.page))
            ){
                return res.status(406).json({message: "No project ID or user ID found in request."});
            }

            try {
                await dbConnect();

                const featuredPipeline = [
                    {$match: {_id: mongoose.Types.ObjectId(req.query.userId)}},
                    {$lookup: {
                        from: "posts",
                        let: {"featuredPostIds": "$featuredPosts", "userId": "$_id"},
                        pipeline: [
                            {$match: {$expr: {$and: [
                                {$in: ["$_id", "$$featuredPostIds"]},
                                {$eq: ["$privacy", "public"]},
                            ]}}},
                            ...postGraphStages,
                        ],
                        as: "posts",
                    }},
                    {$sort: {createdAt: -1}},
                ];

                let conditions: any = req.query.publicFeed ? {} : (
                    req.query.projectId ?
                        { $expr: {$in: [mongoose.Types.ObjectId(req.query.projectId), "$projectIds"] } }
                        :
                        { userId: mongoose.Types.ObjectId(req.query.userId) }
                );

                if (req.query.private) {
                    const session = await getSession({req});
                    if (req.query.userId && req.query.userId !== session.userId) return res.status(403).json({message: "Unauthed"});
                    const reqProjectId: any = req.query.projectId;
                    const project = await ProjectModel.findOne({_id: reqProjectId});
                    if (project.userId.toString() !== session.userId && !project.collaborators.some(d => d.toString() === session.userId)) return res.status(403).json({message: "Unauthed"});
                } else {
                    conditions["privacy"] = "public";
                }

                if (req.query.search) conditions["$text"] = {"$search": req.query.search};
                if (req.query.tag) conditions["tags"] = req.query.tag;

                let cursorStages = getCursorStages(req.query.page, !!req.query.search);

                let graphObj = await (req.query.featured ? UserModel.aggregate(featuredPipeline) : PostModel.aggregate([
                    {$match: conditions},
                    ...postGraphStages,
                    ...cursorStages,
                ]));

                if (req.query.featured) graphObj = graphObj.length ? graphObj[0].posts : [];

                const count = await PostModel
                    .find(conditions)
                    .count();

                return res.status(200).json({posts: graphObj, items: graphObj, count: count});
            } catch (e) {
                return res.status(500).json({message: e});
            }
        default:
            return res.status(405);
    }
}
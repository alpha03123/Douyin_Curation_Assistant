import { CreatorProfile } from "../models/CreatorProfile.js";
import { DownloadTask } from "../models/DownloadTask.js";
import { Keyword } from "../models/Keyword.js";
import { RecommendWork } from "../models/RecommendWork.js";
import { Work } from "../models/Work.js";
import { WorkCommentAnalysis } from "../models/WorkCommentAnalysis.js";

export async function getDashboard(req, res, next) {
  try {
    const [keywords, works, analyzedWorks, creatorCandidates, recommendWorks, downloads] =
      await Promise.all([
        Keyword.countDocuments(),
        Work.countDocuments(),
        WorkCommentAnalysis.countDocuments(),
        CreatorProfile.countDocuments(),
        RecommendWork.countDocuments(),
        DownloadTask.countDocuments(),
      ]);

    res.json({
      data: {
        keywords,
        works,
        analyzedWorks,
        creatorCandidates,
        recommendWorks,
        downloads,
      },
    });
  } catch (error) {
    next(error);
  }
}

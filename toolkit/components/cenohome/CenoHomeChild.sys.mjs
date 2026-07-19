// Copyright (c) 2025, eQualitie

import { RemotePageChild } from "resource://gre/actors/RemotePageChild.sys.mjs";

/**
 * Actor child class for the about:cenohome page.
 * Communication happens through RPM* calls, which do not go through this class.
 */
export class CenoHomeChild extends RemotePageChild {
}
